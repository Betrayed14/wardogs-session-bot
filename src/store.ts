import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { type Board, type Browse, type Details, type Draft, type Job, type Session,
  DRAFT_MS, SESSION_MS, REMINDER_MS, RETENTION_MS, UserError, authorize, id, initialDetails, matches, validateDetails, validateText } from './domain.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS boards (guild_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active ON sessions(guild_id,owner_id) WHERE state IN ('active','publishing');
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS browsing (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, attempts INTEGER NOT NULL, next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private read<T>(table: string, column: string, value: string): T | null {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE ${column}=?`).get(value) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : null;
  }
  board(guildId: string) { return this.read<Board>('boards', 'guild_id', guildId); }
  setBoard(board: Board) {
    this.db.prepare('INSERT INTO boards VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data').run(board.guildId, JSON.stringify(board));
  }
  session(sessionId: string) { return this.read<Session>('sessions', 'id', sessionId); }
  sessions(guildId?: string): Session[] {
    const rows = guildId ? this.db.prepare('SELECT data FROM sessions WHERE guild_id=?').all(guildId) : this.db.prepare('SELECT data FROM sessions').all();
    return rows.map(r => JSON.parse(r.data as string) as Session);
  }
  active(guildId: string, ownerId: string) {
    return this.sessions(guildId).find(s => s.ownerId === ownerId && ['active', 'publishing'].includes(s.state)) ?? null;
  }
  putSession(session: Session) {
    this.db.prepare(`INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data`)
      .run(session.id, session.guildId, session.ownerId, session.state, JSON.stringify(session));
  }
  draft(draftId: string, guildId: string, ownerId: string, now: number): Draft {
    const draft = this.read<Draft>('drafts', 'id', draftId);
    if (!draft || draft.guildId !== guildId || draft.ownerId !== ownerId || draft.expiresAt <= now)
      throw new UserError('This draft has expired or belongs to someone else. Start again with /session create or /session manage.');
    return draft;
  }
  peekDraft(draftId: string) { return this.read<Draft>('drafts', 'id', draftId); }
  putDraft(draft: Draft) {
    this.db.prepare('INSERT INTO drafts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(draft.id, JSON.stringify(draft));
  }
  createDraft(guildId: string, ownerId: string, now: number, sessionId?: string): Draft {
    this.sweep(now);
    if (!this.board(guildId)) throw new UserError('An administrator must first run /board setup channel:#servers.');
    let session: Session | null = null;
    if (sessionId) {
      session = this.session(sessionId);
      if (!session) throw new UserError('Session not found.');
      authorize(session, guildId, ownerId);
      if (session.state !== 'active') throw new UserError('This session is no longer active.');
    } else if (this.active(guildId, ownerId)) throw new UserError('You already have an entry. Use /session manage to edit, renew, or end it.');
    // Keep only one draft for this user; prevents stale editor windows overwriting newer changes.
    for (const row of this.db.prepare('SELECT data FROM drafts').all()) {
      const old = JSON.parse(row.data as string) as Draft;
      if (old.guildId === guildId && old.ownerId === ownerId) this.deleteDraft(old.id);
    }
    const draft: Draft = { id: id(), guildId, ownerId, sessionId: session?.id ?? null, baseRevision: session?.revision ?? null,
      details: session ? structuredClone(session.details) : initialDetails(), createdAt: now, expiresAt: now + DRAFT_MS };
    this.putDraft(draft); return draft;
  }
  updateText(draftId: string, guildId: string, ownerId: string, fields: Pick<Details, 'title' | 'serverId' | 'squad' | 'language' | 'note'>, now: number) {
    const draft = this.draft(draftId, guildId, ownerId, now);
    draft.details = validateText({ ...draft.details, ...fields }); this.putDraft(draft); return draft;
  }
  deleteDraft(draftId: string) { this.db.prepare('DELETE FROM drafts WHERE id=?').run(draftId); }
  publish(draftId: string, guildId: string, ownerId: string, now: number): Session {
    return this.transaction(() => {
      this.sweep(now);
      const draft = this.draft(draftId, guildId, ownerId, now);
      const details = validateDetails(draft.details);
      let session: Session;
      if (draft.sessionId) {
        const existing = this.session(draft.sessionId);
        if (!existing || existing.state !== 'active' || existing.revision !== draft.baseRevision)
          throw new UserError('The session changed or expired while you were editing. Reopen /session manage.');
        authorize(existing, guildId, ownerId);
        session = { ...existing, details, revision: existing.revision + 1 };
      } else {
        if (this.active(guildId, ownerId)) throw new UserError('You already have an active entry. Use /session manage.');
        const board = this.board(guildId);
        if (!board) throw new UserError('The board has not been configured.');
        session = { id: id(), guildId, ownerId, channelId: board.channelId, messageId: null, state: 'publishing', details,
          createdAt: now, confirmedAt: now, expiresAt: now + SESSION_MS, closedAt: null, reminderAt: null,
          revision: 1, nonce: randomBytes(12).toString('hex') };
      }
      this.putSession(session); this.queue(session.id, 'sync', now); this.deleteDraft(draftId); return session;
    });
  }
  renew(sessionId: string, guildId: string, ownerId: string, now: number) {
    return this.transaction(() => {
      this.sweep(now);
      const session = this.requiredSession(sessionId); authorize(session, guildId, ownerId);
      if (session.state !== 'active') throw new UserError('This entry is no longer active. Create a new session.');
      session.confirmedAt = now; session.expiresAt = now + SESSION_MS; session.reminderAt = null; session.revision++;
      this.db.prepare('DELETE FROM jobs WHERE key=?').run(`${session.id}:remind`);
      this.putSession(session); this.queue(session.id, 'sync', now); return session;
    });
  }
  end(sessionId: string, guildId: string, actorId: string, moderator: boolean, now: number) {
    return this.transaction(() => {
      const session = this.requiredSession(sessionId); authorize(session, guildId, actorId, moderator, 'end');
      if (!['active', 'publishing'].includes(session.state)) throw new UserError('This entry has already closed.');
      session.state = 'ended'; session.closedAt = now; session.revision++;
      this.putSession(session); this.queue(session.id, 'sync', now); return session;
    });
  }
  requiredSession(sessionId: string) {
    const session = this.session(sessionId); if (!session) throw new UserError('Session not found.'); return session;
  }
  queue(sessionId: string, kind: Job['kind'], now: number) {
    this.db.prepare(`INSERT INTO jobs VALUES (?,?,?,0,?) ON CONFLICT(key) DO UPDATE SET next_at=MIN(jobs.next_at,excluded.next_at)`)
      .run(`${sessionId}:${kind}`, sessionId, kind, now);
  }
  jobs(now: number, sessionId?: string): Job[] {
    const rows = sessionId ? this.db.prepare('SELECT * FROM jobs WHERE next_at<=? AND session_id=? ORDER BY next_at').all(now, sessionId)
      : this.db.prepare('SELECT * FROM jobs WHERE next_at<=? ORDER BY next_at LIMIT 50').all(now);
    return rows
      .map(r => ({ key: r.key as string, sessionId: r.session_id as string, kind: r.kind as Job['kind'], attempts: r.attempts as number, nextAt: r.next_at as number }));
  }
  done(key: string) { this.db.prepare('DELETE FROM jobs WHERE key=?').run(key); }
  retry(job: Job, now: number) {
    this.db.prepare('UPDATE jobs SET attempts=attempts+1,next_at=? WHERE key=?')
      .run(now + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(job.attempts, 5)), job.key);
  }
  backlog() { return (this.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n; }
  pending(sessionId: string) { return !!this.db.prepare("SELECT key FROM jobs WHERE session_id=? AND kind='sync'").get(sessionId); }
  sweep(now: number) {
    for (const session of this.sessions()) {
      if (['active', 'publishing'].includes(session.state) && session.expiresAt <= now) {
        session.state = 'expired'; session.closedAt = now; session.revision++;
        this.putSession(session); this.queue(session.id, 'sync', now);
      } else if (session.state === 'active' && !session.reminderAt && session.expiresAt - now <= REMINDER_MS)
        this.queue(session.id, 'remind', now);
      if (session.closedAt && now - session.closedAt >= RETENTION_MS) {
        const pending = this.db.prepare('SELECT key FROM jobs WHERE session_id=?').get(session.id);
        if (!pending) this.db.prepare('DELETE FROM sessions WHERE id=?').run(session.id);
      }
    }
    for (const table of ['drafts', 'browsing']) {
      for (const row of this.db.prepare(`SELECT id,data FROM ${table}`).all())
        if ((JSON.parse(row.data as string) as { expiresAt: number }).expiresAt <= now)
          this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id as string);
    }
  }
  createBrowse(guildId: string, ownerId: string, filters: Pick<Browse, 'atmosphere' | 'playstyle' | 'language'>, now: number): Browse {
    const view: Browse = { id: id(), guildId, ownerId, ...filters, expiresAt: now + DRAFT_MS };
    this.db.prepare('INSERT INTO browsing VALUES (?,?)').run(view.id, JSON.stringify(view)); return view;
  }
  browse(viewId: string, guildId: string, ownerId: string, now: number) {
    const view = this.read<Browse>('browsing', 'id', viewId);
    if (!view || view.guildId !== guildId || view.ownerId !== ownerId || view.expiresAt <= now)
      throw new UserError('These results expired. Run /sessions again.');
    return view;
  }
  results(view: Browse, now: number) {
    return this.sessions(view.guildId).filter(s => s.messageId && matches(s, view, now)).sort((a, b) => b.confirmedAt - a.confirmedAt || a.id.localeCompare(b.id));
  }
  meta(key: string) { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setMeta(key: string, value: string) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  async backupTo(path: string) { mkdirSync(dirname(path), { recursive: true }); await backup(this.db, path); }
}
