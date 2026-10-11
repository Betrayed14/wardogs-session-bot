import { join } from 'node:path';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { type Session, REMINDER_MS, UserError } from './domain.js';
import { Store } from './store.js';

export interface Transport {
  findSession(session: Session): Promise<string | null>;
  sendSession(session: Session): Promise<string>;
  editSession(session: Session): Promise<void>;
  deleteSession(session: Session): Promise<void>;
  remind(session: Session): Promise<void>;
}
export type Logger = (event: string, fields?: Record<string, string | number | boolean>) => void;
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return error instanceof UserError ? 'permission_or_validation' : 'unexpected';
}
export function missing(error: unknown) { return ['10008', '10003'].includes(errorCode(error)); }
export const log: Logger = (event, fields = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));

/** Serialize mutations and network synchronization without holding a SQLite transaction across await. */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn); this.tail = result.catch(() => undefined); return result;
  }
}
export class Worker {
  private lastReconcile = 0;
  constructor(readonly store: Store, readonly transport: Transport, readonly logger: Logger = log,
    readonly now: () => number = Date.now, readonly backupDirectory?: string) {}
  async tick(targetSessionId?: string) {
    const now = this.now(); this.store.sweep(now);
    // Also inspect idle cards for external deletion. On startup lastReconcile is zero.
    if (now - this.lastReconcile >= 60 * 60_000) {
      for (const s of this.store.sessions()) if (s.state === 'active') this.store.queue(s.id, 'sync', now);
      this.lastReconcile = now;
    }
    const due = this.store.jobs(now, targetSessionId);
    for (const job of targetSessionId ? due : due.slice(0, 5)) {
      const session = this.store.session(job.sessionId);
      if (!session) { this.store.done(job.key); continue; }
      try {
        if (job.kind === 'remind') {
          if (session.state === 'active' && session.expiresAt > now && session.expiresAt - now <= REMINDER_MS && !session.reminderAt) {
            // Persist before sending: at most one reminder attempt per renewal, even after a crash.
            session.reminderAt = now; this.store.putSession(session);
            try { await this.transport.remind(session); this.logger('reminder_sent', { sessionId: session.id }); }
            catch (error) { this.logger('reminder_failed', { sessionId: session.id, code: errorCode(error) }); }
          }
          this.store.done(job.key); continue;
        }
        if (!session.messageId) {
          // Scan bot-authored history before every send, including after a crash. Fail closed if history cannot be read.
          const recovered = await this.transport.findSession(session);
          if (recovered) { session.messageId = recovered; this.store.putSession(session); }
        }
        if (['ended', 'expired'].includes(session.state)) {
          if (session.messageId) await this.transport.deleteSession(session);
        } else {
          if (!session.messageId) {
            session.messageId = await this.transport.sendSession(session);
            session.state = 'active'; this.store.putSession(session);
          } else {
            await this.transport.editSession(session);
            if (session.state === 'publishing') { session.state = 'active'; this.store.putSession(session); }
          }
        }
        this.store.done(job.key);
      } catch (error) {
        if (missing(error)) {
          if (['active', 'publishing'].includes(session.state)) {
            session.state = 'removed'; session.closedAt = now; this.store.putSession(session);
          }
          this.store.done(job.key);
          this.logger('card_removed', { sessionId: session.id });
        } else {
          this.store.retry(job, now);
          this.logger('sync_failed', { sessionId: session.id, code: errorCode(error), attempt: job.attempts + 1 });
        }
      }
    }
    if (this.store.backlog()) this.logger('cleanup_backlog', { jobs: this.store.backlog() });
    await this.backupIfDue(now);
  }
  private async backupIfDue(now: number) {
    if (!this.backupDirectory) return;
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.store.meta('last_backup') === day) return;
    try {
      mkdirSync(this.backupDirectory, { recursive: true });
      await this.store.backupTo(join(this.backupDirectory, `wardogs-${day}.sqlite`));
      this.store.setMeta('last_backup', day);
      for (const name of readdirSync(this.backupDirectory).filter(n => /^wardogs-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort().slice(0, -7))
        unlinkSync(join(this.backupDirectory, name));
      this.logger('backup_complete');
    } catch (error) { this.logger('backup_failed', { code: errorCode(error) }); }
  }
}
