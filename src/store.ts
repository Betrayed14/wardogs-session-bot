import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { type Board, type Browse, type Challenge, type ChallengeDetails, type ChallengeState, type Details, type Draft, type Job, type ReportOutcome, type Session, type SquadStats,
  CHALLENGE_MS, DRAFT_MS, SESSION_MS, REMINDER_MS, RETENTION_MS, UserError, authorize, id, initialDetails, matches, validateChallengeDetails, validateDetails, validateText } from './domain.js';

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
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenge_boards (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, issuer_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS squad_stats (guild_id TEXT NOT NULL, squad_name TEXT NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, draws INTEGER NOT NULL, points INTEGER NOT NULL, PRIMARY KEY (guild_id, squad_name));`);
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
    for (const ch of this.challenges()) {
      if (['open', 'accepted'].includes(ch.state) && ch.expiresAt <= now) {
        ch.state = 'expired'; ch.closedAt = now; this.putChallenge(ch);
      }
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
  challengeBoard(guildId: string): string | null {
    const row = this.db.prepare('SELECT channel_id FROM challenge_boards WHERE guild_id=?').get(guildId) as { channel_id: string } | undefined;
    return row?.channel_id ?? null;
  }
  setChallengeBoard(guildId: string, channelId: string) {
    this.db.prepare('INSERT INTO challenge_boards VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id').run(guildId, channelId);
  }
  challenge(id: string): Challenge | null {
    return this.read<Challenge>('challenges', 'id', id);
  }
  challenges(guildId?: string, state?: ChallengeState): Challenge[] {
    let sql = 'SELECT data FROM challenges';
    const params: string[] = [];
    const clauses: string[] = [];
    if (guildId) { clauses.push('guild_id=?'); params.push(guildId); }
    if (state) { clauses.push('state=?'); params.push(state); }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => JSON.parse(r.data as string) as Challenge);
  }
  putChallenge(challenge: Challenge) {
    this.db.prepare('INSERT INTO challenges VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data')
      .run(challenge.id, challenge.guildId, challenge.issuerId, challenge.state, JSON.stringify(challenge));
  }
  createChallenge(guildId: string, issuerId: string, details: ChallengeDetails, now: number): Challenge {
    this.sweep(now);
    const valid = validateChallengeDetails(details);
    const channelId = this.challengeBoard(guildId) ?? this.board(guildId)?.channelId;
    if (!channelId) throw new UserError('An administrator must first configure a board with /board setup or /challenge setup.');
    const ch: Challenge = {
      id: id(), guildId, issuerId, opponentId: null, details: valid,
      state: 'open', createdAt: now, acceptedAt: null, expiresAt: now + CHALLENGE_MS,
      closedAt: null, reports: {}, winnerId: null, messageId: null, channelId
    };
    this.putChallenge(ch);
    return ch;
  }
  acceptChallenge(challengeId: string, guildId: string, opponentId: string, now: number): Challenge {
    return this.transaction(() => {
      this.sweep(now);
      const ch = this.challenge(challengeId);
      if (!ch || ch.guildId !== guildId) throw new UserError('Challenge not found.');
      if (ch.state !== 'open') throw new UserError('This challenge is no longer open.');
      if (ch.issuerId === opponentId) throw new UserError('You cannot accept your own challenge.');
      if (ch.details.targetOpponentId && ch.details.targetOpponentId !== opponentId)
        throw new UserError('This challenge was issued directly to another player.');
      ch.opponentId = opponentId;
      ch.state = 'accepted';
      ch.acceptedAt = now;
      ch.expiresAt = now + CHALLENGE_MS;
      this.putChallenge(ch);
      return ch;
    });
  }
  withdrawChallenge(challengeId: string, guildId: string, actorId: string, isModerator: boolean, now: number): Challenge {
    return this.transaction(() => {
      const ch = this.challenge(challengeId);
      if (!ch || ch.guildId !== guildId) throw new UserError('Challenge not found.');
      if (!['open', 'accepted', 'disputed'].includes(ch.state)) throw new UserError('This challenge has already concluded.');
      if (ch.issuerId !== actorId && !isModerator)
        throw new UserError('Only the challenger or a moderator can cancel this challenge.');
      ch.state = 'withdrawn';
      ch.closedAt = now;
      this.putChallenge(ch);
      return ch;
    });
  }
  reportChallenge(challengeId: string, guildId: string, actorId: string, outcome: ReportOutcome, now: number): Challenge {
    return this.transaction(() => {
      const ch = this.challenge(challengeId);
      if (!ch || ch.guildId !== guildId) throw new UserError('Challenge not found.');
      if (!['accepted', 'disputed'].includes(ch.state)) throw new UserError('This challenge is not currently active.');
      if (ch.issuerId !== actorId && ch.opponentId !== actorId)
        throw new UserError('Only participants in this challenge can report the result.');
      ch.reports[actorId] = outcome;
      if (ch.issuerId && ch.opponentId && ch.reports[ch.issuerId] && ch.reports[ch.opponentId]) {
        const issuerReport = ch.reports[ch.issuerId];
        const opponentReport = ch.reports[ch.opponentId];
        if (issuerReport === opponentReport) {
          ch.state = 'completed';
          ch.closedAt = now;
          if (issuerReport === 'draw') ch.winnerId = 'draw';
          else if (issuerReport === 'issuer_win') ch.winnerId = ch.issuerId;
          else ch.winnerId = ch.opponentId;
          this.applyStats(guildId, ch);
        } else {
          ch.state = 'disputed';
        }
      }
      this.putChallenge(ch);
      return ch;
    });
  }
  resolveDispute(challengeId: string, guildId: string, _moderatorId: string, outcome: ReportOutcome, now: number): Challenge {
    return this.transaction(() => {
      const ch = this.challenge(challengeId);
      if (!ch || ch.guildId !== guildId) throw new UserError('Challenge not found.');
      if (ch.state !== 'disputed') throw new UserError('This challenge is not disputed.');
      ch.state = 'completed';
      ch.closedAt = now;
      if (outcome === 'draw') ch.winnerId = 'draw';
      else if (outcome === 'issuer_win') ch.winnerId = ch.issuerId;
      else ch.winnerId = ch.opponentId;
      this.applyStats(guildId, ch);
      this.putChallenge(ch);
      return ch;
    });
  }
  private applyStats(guildId: string, ch: Challenge) {
    if (!ch.issuerId || !ch.opponentId || !ch.winnerId) return;
    const isDraw = ch.winnerId === 'draw';
    this.updateSquadStat(guildId, ch.issuerId, isDraw ? 'draw' : ch.winnerId === ch.issuerId ? 'win' : 'loss');
    this.updateSquadStat(guildId, ch.opponentId, isDraw ? 'draw' : ch.winnerId === ch.opponentId ? 'win' : 'loss');
  }
  private updateSquadStat(guildId: string, participantId: string, result: 'win' | 'loss' | 'draw') {
    const existing = this.db.prepare('SELECT * FROM squad_stats WHERE guild_id=? AND squad_name=?').get(guildId, participantId) as SquadStats | undefined;
    const wins = (existing?.wins ?? 0) + (result === 'win' ? 1 : 0);
    const losses = (existing?.losses ?? 0) + (result === 'loss' ? 1 : 0);
    const draws = (existing?.draws ?? 0) + (result === 'draw' ? 1 : 0);
    const points = wins * 3 + draws * 1;
    this.db.prepare('INSERT INTO squad_stats VALUES (?,?,?,?,?,?) ON CONFLICT(guild_id, squad_name) DO UPDATE SET wins=excluded.wins, losses=excluded.losses, draws=excluded.draws, points=excluded.points')
      .run(guildId, participantId, wins, losses, draws, points);
  }
  leaderboard(guildId: string): SquadStats[] {
    const rows = this.db.prepare('SELECT * FROM squad_stats WHERE guild_id=? ORDER BY points DESC, wins DESC LIMIT 10').all(guildId);
    return rows.map(r => ({
      guildId: r.guild_id as string, squadName: r.squad_name as string,
      wins: r.wins as number, losses: r.losses as number, draws: r.draws as number, points: r.points as number
    }));
  }
  meta(key: string) { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setMeta(key: string, value: string) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  async backupTo(path: string) { mkdirSync(dirname(path), { recursive: true }); await backup(this.db, path); }
}
