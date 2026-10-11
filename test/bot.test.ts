import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { SESSION_MS, DRAFT_MS, REMINDER_MS, RETENTION_MS, UserError, authorize, escapeText,
  initialDetails, noMentions, paginate, validateDetails, validateText, type Details, type Session } from '../src/domain.js';
import { Store } from '../src/store.js';
import { Worker, Serial, type Transport } from '../src/worker.js';
import { commands } from '../src/commands.js';
import { boardMessage, card, detailsModal, preview, browseMessage } from '../src/ui.js';
import { assertAudienceVoice } from '../src/discord.js';

const T = Date.UTC(2026, 9, 11, 15);
function details(overrides: Partial<Details> = {}): Details {
  return { ...initialDetails(), title: 'Building crew', serverId: '001-002', faction: 'Blue / Lonestar',
    atmosphere: ['Chill', 'Beginner friendly'], playstyle: ['Building / FOBs', 'Logistics'], ...overrides };
}
function fixture() {
  const store = new Store(':memory:'); store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'intro' }); return store;
}
function publish(store: Store, ownerId = 'u', now = T, overrides: Partial<Details> = {}) {
  const draft = store.createDraft('g', ownerId, now);
  draft.details = details(overrides); store.putDraft(draft); return store.publish(draft.id, 'g', ownerId, now);
}
class FakeTransport implements Transport {
  messages = new Map<string, Session>();
  sends = 0; edits = 0; reminders = 0; deletes = 0;
  ambiguous = false; outage = false; historyOutage = false; dmBlocked = false;
  async findSession(session: Session) {
    if (this.historyOutage) throw Object.assign(new Error(), { code: 'ETIMEDOUT' });
    return [...this.messages].find(([, s]) => s.id === session.id)?.[0] ?? null;
  }
  async sendSession(session: Session) {
    if (this.outage) throw Object.assign(new Error(), { code: 503 });
    const messageId = `m${++this.sends}`; this.messages.set(messageId, structuredClone(session));
    if (this.ambiguous) { this.ambiguous = false; throw Object.assign(new Error(), { code: 'ETIMEDOUT' }); }
    return messageId;
  }
  async editSession(session: Session) {
    if (this.outage) throw Object.assign(new Error(), { code: 503 });
    if (!this.messages.has(session.messageId!)) throw Object.assign(new Error(), { code: 10008 });
    this.messages.set(session.messageId!, structuredClone(session)); this.edits++;
  }
  async deleteSession(session: Session) {
    if (this.outage) throw Object.assign(new Error(), { code: 503 });
    if (!this.messages.delete(session.messageId!)) throw Object.assign(new Error(), { code: 10008 });
    this.deletes++;
  }
  async remind() { this.reminders++; if (this.dmBlocked) throw Object.assign(new Error(), { code: 50007 }); }
}

test('server IDs remain strings, preserving leading zeros and case', () => {
  for (const serverId of ['00042', '001-009', 'ABCD1234-AB12-CD34-EF56-123456789ABC'])
    assert.equal(validateText(details({ serverId: ` ${serverId} ` })).serverId, serverId);
  for (const serverId of ['', '42--7', '42-', '1.5', '-42', 'server 42', 'https://example.com', '1'.repeat(65)])
    assert.throws(() => validateText(details({ serverId })), UserError);
});
test('field and preset validation handles limits, duplicates, and missing required tags', () => {
  assert.doesNotThrow(() => validateDetails(details({ title: 'a'.repeat(80), squad: 'a'.repeat(60), language: 'a'.repeat(40), note: 'a'.repeat(300) })));
  for (const overrides of [{ title: 'a'.repeat(81) }, { squad: 'a'.repeat(61) }, { language: 'a'.repeat(41) }, { note: 'a'.repeat(301) },
    { title: ' ' }, { language: '' }, { note: '\x00' }, { faction: '' }, { microphone: 'Yes' }, { atmosphere: [] },
    { atmosphere: ['Chill', 'Chill'] }, { atmosphere: ['Chill', 'Friendly', 'Competitive'] }, { playstyle: ['Unknown'] }])
    assert.throws(() => validateDetails(details(overrides)), UserError);
});
test('authorization allows only the creator to edit/renew and board moderators to end', () => {
  const store = fixture(); const s = publish(store);
  assert.doesNotThrow(() => authorize(s, 'g', 'u'));
  assert.throws(() => authorize(s, 'other', 'u'), UserError);
  assert.throws(() => authorize(s, 'g', 'stranger'), UserError);
  assert.throws(() => authorize(s, 'g', 'mod', true, 'renew'), UserError);
  assert.doesNotThrow(() => authorize(s, 'g', 'mod', true, 'end'));
  assert.throws(() => store.end(s.id, 'g', 'stranger', false, T), UserError);
  store.end(s.id, 'g', 'mod', true, T); store.close();
});
test('transactional publication prevents duplicate entries; same server is allowed for separate groups', () => {
  const store = fixture(); const first = publish(store);
  assert.throws(() => store.createDraft('g', 'u', T), UserError);
  assert.throws(() => store.publish('no-draft', 'g', 'u', T), UserError);
  const second = publish(store, 'u2'); assert.equal(first.details.serverId, second.details.serverId);
  assert.equal(store.sessions().length, 2);
  // Database invariant also protects callers bypassing the service layer.
  assert.throws(() => store.putSession({ ...first, id: 'duplicate' })); store.close();
});
test('expired drafts and drafts owned by another member cannot publish', () => {
  const store = fixture(); const draft = store.createDraft('g', 'u', T); draft.details = details(); store.putDraft(draft);
  assert.throws(() => store.publish(draft.id, 'g', 'v', T), UserError);
  assert.throws(() => store.publish(draft.id, 'g', 'u', T + DRAFT_MS), UserError);
  assert.equal(store.sessions().length, 0); store.close();
});
test('edit saves do not renew and stale edits cannot overwrite a renewal', async () => {
  const store = fixture(); const s = publish(store); const transport = new FakeTransport();
  await new Worker(store, transport, () => {}, () => T).tick();
  const draft = store.createDraft('g', 'u', T + 100, s.id); draft.details.note = 'New note'; store.putDraft(draft);
  const edited = store.publish(draft.id, 'g', 'u', T + 200);
  assert.equal(edited.expiresAt, s.expiresAt); assert.equal(edited.confirmedAt, T);
  const stale = store.createDraft('g', 'u', T + 300, s.id);
  store.renew(s.id, 'g', 'u', T + 400);
  assert.throws(() => store.publish(stale.id, 'g', 'u', T + 500), /changed/); store.close();
});
test('renew/expire boundary is deterministic and closing removes the active uniqueness constraint', async () => {
  const store = fixture(); const transport = new FakeTransport(); let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); const s = publish(store); await worker.tick();
  now = T + SESSION_MS - 1; const renewed = store.renew(s.id, 'g', 'u', now); assert.equal(renewed.expiresAt, now + SESSION_MS);
  await worker.tick(); assert.equal(transport.sends, 1);
  now = renewed.expiresAt; assert.throws(() => store.renew(s.id, 'g', 'u', now), /no longer active/);
  await worker.tick(); assert.equal(store.session(s.id)!.state, 'expired'); assert.equal(transport.messages.size, 0);
  assert.doesNotThrow(() => publish(store, 'u', now)); store.close();
});
test('ambiguous send is recovered from history with no duplicate publication', async () => {
  const store = fixture(); const transport = new FakeTransport(); transport.ambiguous = true; let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); const s = publish(store); await worker.tick();
  assert.equal(store.session(s.id)!.state, 'publishing'); assert.equal(transport.sends, 1); assert.equal(store.backlog(), 1);
  now += 31_000; await worker.tick(); assert.equal(transport.sends, 1); assert.equal(store.session(s.id)!.state, 'active');
  assert.equal(store.backlog(), 0); store.close();
});
test('history outage fails closed instead of republishing and eventual retry succeeds', async () => {
  const store = fixture(); const transport = new FakeTransport(); transport.historyOutage = true; let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); publish(store); await worker.tick(); assert.equal(transport.sends, 0);
  transport.historyOutage = false; now += 31_000; await worker.tick(); assert.equal(transport.sends, 1); store.close();
});
test('closing an ambiguously published session reconciles and deletes the orphan card', async () => {
  const store = fixture(); const transport = new FakeTransport(); transport.ambiguous = true; let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); const s = publish(store); await worker.tick();
  store.end(s.id, 'g', 'u', false, ++now); await worker.tick();
  assert.equal(transport.sends, 1); assert.equal(transport.messages.size, 0); assert.equal(store.backlog(), 0); store.close();
});
test('failed cleanup retries with backoff, and retention waits for cleanup', async () => {
  const store = fixture(); const transport = new FakeTransport(); let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); const s = publish(store); await worker.tick();
  store.end(s.id, 'g', 'u', false, now); transport.outage = true; await worker.tick();
  assert.equal(store.jobs(now).length, 0); assert.equal(store.backlog(), 1);
  now += RETENTION_MS + 1000; await worker.tick(); assert.ok(store.session(s.id));
  transport.outage = false; now += 61_000; await worker.tick(); store.sweep(now);
  assert.equal(store.session(s.id), null); store.close();
});
test('blocked DMs are attempted only once per renewal and do not prevent expiry', async () => {
  const store = fixture(); const transport = new FakeTransport(); transport.dmBlocked = true; let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); const s = publish(store); await worker.tick();
  now = T + SESSION_MS - REMINDER_MS; await worker.tick(); await worker.tick(); assert.equal(transport.reminders, 1);
  store.renew(s.id, 'g', 'u', now); await worker.tick();
  now += SESSION_MS - REMINDER_MS; await worker.tick(); assert.equal(transport.reminders, 2);
  now += REMINDER_MS; await worker.tick(); assert.equal(store.session(s.id)!.state, 'expired'); store.close();
});
test('external deletion is detected and not resurrected', async () => {
  const store = fixture(); const transport = new FakeTransport(); let now = T;
  const worker = new Worker(store, transport, () => {}, () => now); const s = publish(store); await worker.tick();
  transport.messages.clear(); now += 60 * 60_000; await worker.tick();
  assert.equal(store.session(s.id)!.state, 'removed'); assert.equal(transport.sends, 1); store.close();
});
test('SQLite restart restores pending jobs, draft data, and persistent card IDs', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'wardogs-')); const path = join(folder, 'db.sqlite'); const transport = new FakeTransport();
  try {
    let store = new Store(path); store.setBoard({ guildId: 'g', channelId: 'c', messageId: null }); const s = publish(store);
    const draft = store.createDraft('g', 'v', T); draft.details = details(); store.putDraft(draft); store.close();
    store = new Store(path); assert.equal(store.draft(draft.id, 'g', 'v', T).details.serverId, '001-002');
    await new Worker(store, transport, () => {}, () => T).tick(); store.close();
    store = new Store(path); assert.equal(store.requiredSession(s.id).messageId, 'm1');
    store.renew(s.id, 'g', 'u', T + 1000); await new Worker(store, transport, () => {}, () => T + 1000).tick();
    assert.equal(transport.sends, 1); assert.ok(transport.edits); store.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('filtering uses AND semantics, exact case-insensitive language, and five-card pages', async () => {
  const store = fixture(); const transport = new FakeTransport();
  for (let i = 0; i < 12; i++) publish(store, `u${i}`, T, { language: i === 11 ? 'French' : 'English' });
  const worker = new Worker(store, transport, () => {}, () => T);
  await worker.tick(); await worker.tick(); await worker.tick();
  const view = store.createBrowse('g', 'browser', { atmosphere: 'Chill', playstyle: 'Logistics', language: ' eNgLiSh ' }, T);
  const result = store.results(view, T); assert.equal(result.length, 11);
  assert.equal(paginate(result, 0).items.length, 5); assert.equal(paginate(result, 1).items.length, 5);
  assert.equal(paginate(result, 100).items.length, 1);
  assert.equal(store.results({ ...view, playstyle: 'Vehicles' }, T).length, 0);
  assert.equal(store.results(view, T + SESSION_MS).length, 0);
  assert.throws(() => store.browse(view.id, 'g', 'other', T), UserError); store.close();
});
test('payloads stay within Discord row/field limits and suppress user mentions', () => {
  const store = fixture(); const s = publish(store, 'u', T, { title: '@everyone **test**', note: '<@123> [link](https://example.com)' });
  const draft = store.createDraft('g', 'other', T); draft.details = details();
  assert.equal(detailsModal(draft).toJSON().components!.length, 5);
  for (const voice of [false, true]) {
    const payload = preview(draft, voice);
    assert.ok(payload.components.length <= 5);
    for (const row of payload.components) assert.ok(row.toJSON().components.length <= 5);
  }
  for (const payload of [card(s), boardMessage('g'), preview(draft), browseMessage({ id: 'b', guildId: 'g', ownerId: 'u', expiresAt: T }, [s])]) {
    assert.deepEqual(payload.allowedMentions, noMentions);
    for (const embed of payload.embeds) assert.doesNotThrow(() => embed.toJSON());
  }
  const rendered = JSON.stringify(card(s).embeds[0].toJSON());
  assert.ok(!rendered.includes('@everyone')); assert.ok(!rendered.includes('<@123>'));
  assert.equal(escapeText('**x**'), '\\*\\*x\\*\\*');
  for (const command of commands) assert.equal(command.dm_permission, false);
  assert.equal(commands.length, 5); store.close();
});
test('voice audience proof rejects hidden or restrictive voice channels', () => {
  const view = PermissionFlagsBits.ViewChannel; const connect = PermissionFlagsBits.Connect;
  const bits = (value: bigint) => ({ has: (p: bigint | bigint[]) => (Array.isArray(p) ? p : [p]).every(x => (value & x) === x) });
  const guild = { id: 'g', roles: { cache: new Map([['g', { id: 'g' }]]), everyone: { id: 'g' } } };
  const board = { guild, permissionsFor: () => bits(view), permissionOverwrites: { cache: new Map() } };
  const voice = { guild, permissionsFor: () => bits(view | connect), permissionOverwrites: { cache: new Map() } };
  assert.doesNotThrow(() => assertAudienceVoice(board as never, voice as never));
  assert.throws(() => assertAudienceVoice(board as never, { ...voice, permissionsFor: () => bits(0n) } as never), UserError);
  const restricted = { ...voice, permissionOverwrites: { cache: new Map([['r', { id: 'r', deny: bits(connect) }]]) } };
  assert.throws(() => assertAudienceVoice(board as never, restricted as never), UserError);
});
test('serial executor survives failed jobs and orders concurrent actions', async () => {
  const serial = new Serial(); const events: number[] = [];
  const results = await Promise.allSettled([
    serial.run(async () => { await Promise.resolve(); events.push(1); throw new Error('failure'); }),
    serial.run(() => { events.push(2); }), serial.run(() => { events.push(3); }),
  ]);
  assert.equal(results[0].status, 'rejected'); assert.deepEqual(events, [1, 2, 3]);
});
test('online backup is readable and daily backups retain the latest seven', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'wardogs-backup-')); const store = fixture();
  try {
    publish(store); const transport = new FakeTransport(); let now = T;
    const worker = new Worker(store, transport, () => {}, () => now, folder);
    for (let i = 0; i < 9; i++) { now = T + i * 86400_000; await worker.tick(); }
    const files = readdirSync(folder); assert.equal(files.length, 7);
    const copy = new Store(join(folder, files.sort().at(-1)!)); assert.equal(copy.board('g')!.channelId, 'c'); copy.close();
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
