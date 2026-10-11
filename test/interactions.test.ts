import test from 'node:test';
import assert from 'node:assert/strict';
import { type Client, type Interaction, MessageFlags, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { Handler } from '../src/handler.js';
import { DiscordTransport } from '../src/discord.js';
import { Store } from '../src/store.js';
import { Worker, Serial, type Transport } from '../src/worker.js';
import { SESSION_MS, type Draft, type Session } from '../src/domain.js';

type Payload = { content?: string; flags?: number; components?: { toJSON(): { components: { custom_id?: string }[] } }[]; embeds?: unknown[] };
function interaction(kind: string, customId = '', overrides: Record<string, unknown> = {}) {
  const events: string[] = []; const replies: Payload[] = []; let modalId = '';
  const mock = {
    type: 2, guildId: 'g', user: { id: 'u' }, customId, deferred: false, replied: false,
    isRepliable: () => true, isButton: () => kind === 'button', isChatInputCommand: () => kind === 'command',
    isStringSelectMenu: () => kind === 'select', isChannelSelectMenu: () => kind === 'channel', isModalSubmit: () => kind === 'modal',
    async deferReply(payload: Payload) { events.push('defer'); assert.equal(payload.flags, MessageFlags.Ephemeral); mock.deferred = true; },
    async deferUpdate() { events.push('deferUpdate'); mock.deferred = true; },
    async showModal(modal: { toJSON(): { custom_id: string } }) { events.push('modal'); modalId = modal.toJSON().custom_id; mock.replied = true; },
    async reply(payload: Payload) { events.push('reply'); replies.push(payload); mock.replied = true; },
    async editReply(payload: Payload) { events.push('edit'); replies.push(payload); },
    async followUp(payload: Payload) { events.push('followup'); replies.push(payload); },
    ...overrides,
  };
  return { raw: mock as unknown as Interaction, mock, events, replies, modalId: () => modalId };
}
function context() {
  const store = new Store(':memory:'); store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'intro' });
  let moderator = false;
  const member = { id: 'u' };
  const board = { guild: { members: { fetch: async () => member } }, permissionsFor: () =>
    new PermissionsBitField(PermissionFlagsBits.ViewChannel | (moderator ? PermissionFlagsBits.ManageMessages : 0n)) };
  const client = {} as Client;
  const transport = {
    channel: async () => board, findSession: async () => null, sendSession: async () => 'message',
    editSession: async () => {}, deleteSession: async () => {}, remind: async () => {}, setup: async () => store.board('g'),
  };
  const worker = new Worker(store, transport as Transport, () => {});
  const handler = new Handler(client, store, transport as unknown as DiscordTransport, worker, new Serial());
  return { store, handler, setModerator: (value: boolean) => { moderator = value; } };
}
async function fillDraft(handler: Handler, draft: Draft) {
  for (const [field, values] of [['faction', ['Blue / Lonestar']], ['atmosphere', ['Chill']], ['playstyle', ['Building / FOBs']], ['microphone', ['Optional']]] as const) {
    const select = interaction('select', `d:${field}:${draft.id}`, { values });
    await handler.handle(select.raw); assert.equal(select.events[0], 'deferUpdate'); assert.equal(select.events.at(-1), 'edit');
  }
}
async function create(handler: Handler, store: Store): Promise<Session> {
  const form = interaction('modal', 'f:new', { fields: { getTextInputValue: (key: string) =>
    ({ title: 'Friendly builders', serverId: '00012', squad: '', language: 'English', note: 'New players welcome' } as Record<string, string>)[key] } });
  await handler.handle(form.raw);
  const draftId = form.replies[0].components![0].toJSON().components[0].custom_id!.split(':')[2];
  const draft = store.draft(draftId, 'g', 'u', Date.now()); await fillDraft(handler, draft);
  const publish = interaction('button', `d:publish:${draftId}`); await handler.handle(publish.raw);
  assert.match(publish.replies[0].content!, /Open card/); return store.active('g', 'u')!;
}
test('create button opens a modal immediately without persistent drafts or network work', async () => {
  const { store, handler } = context(); const press = interaction('button', 'board:create');
  await handler.handle(press.raw); assert.deepEqual(press.events, ['modal']); assert.equal(press.modalId(), 'f:new');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM drafts').get()!.n, 0); store.close();
});
test('full interaction flow publishes one tagged card, renews, and ends it', async () => {
  const { store, handler } = context(); const session = await create(handler, store);
  assert.equal(session.state, 'active'); assert.equal(session.details.serverId, '00012');
  assert.deepEqual(session.details.playstyle, ['Building / FOBs']);
  const showId = interaction('button', `s:id:${session.id}`); await handler.handle(showId.raw);
  assert.match(showId.replies[0].content!, /00012/); assert.equal(showId.events[0], 'defer');
  const renew = interaction('button', `s:renew:${session.id}`); await handler.handle(renew.raw);
  assert.match(renew.replies[0].content!, /two hours/);
  const renewed = store.requiredSession(session.id); assert.equal(renewed.expiresAt - renewed.confirmedAt, SESSION_MS);
  const end = interaction('button', `s:end:${session.id}`); await handler.handle(end.raw);
  assert.equal(store.requiredSession(session.id).state, 'ended'); store.close();
});
test('moderator can end another group but cannot edit or renew it', async () => {
  const { store, handler, setModerator } = context(); const session = await create(handler, store); setModerator(true);
  const stranger = { user: { id: 'mod' } };
  const edit = interaction('button', `s:edit:${session.id}`, stranger); await handler.handle(edit.raw);
  assert.match(edit.replies[0].content!, /Only the creator/); assert.ok(!edit.events.includes('modal'));
  const renew = interaction('button', `s:renew:${session.id}`, stranger); await handler.handle(renew.raw);
  assert.match(renew.replies[0].content!, /Only the creator/);
  const end = interaction('button', `s:end:${session.id}`, stranger); await handler.handle(end.raw);
  assert.equal(store.requiredSession(session.id).state, 'ended'); store.close();
});
test('private DM reminder controls allow creator renewal and edit forms', async () => {
  const { store, handler } = context(); const session = await create(handler, store);
  const renew = interaction('button', `s:renew:${session.id}`, { guildId: null }); await handler.handle(renew.raw);
  assert.match(renew.replies[0].content!, /renewed/);
  const edit = interaction('button', `s:edit:${session.id}`, { guildId: null }); await handler.handle(edit.raw);
  assert.match(edit.modalId(), /^f:edit:/);
  const form = interaction('modal', edit.modalId(), { guildId: null, fields: { getTextInputValue: (key: string) =>
    ({ title: 'Changed title', serverId: '00012', squad: 'DOGS', language: 'English', note: '' } as Record<string, string>)[key] } });
  await handler.handle(form.raw); assert.equal(form.events.at(-1), 'edit');
  const draftId = form.replies[0].components![0].toJSON().components[0].custom_id!.split(':')[2];
  const save = interaction('button', `d:publish:${draftId}`, { guildId: null }); await handler.handle(save.raw);
  assert.equal(store.requiredSession(session.id).details.title, 'Changed title'); store.close();
});
test('invalid modal input remains correctable in a safe private preview', async () => {
  const { store, handler } = context();
  const form = interaction('modal', 'f:new', { fields: { getTextInputValue: (key: string) =>
    ({ title: 'title', serverId: '```@everyone', squad: '', language: ' ', note: '' } as Record<string, string>)[key] } });
  await handler.handle(form.raw);
  assert.match(form.replies[0].content!, /correct/); assert.equal(form.events.at(-1), 'edit');
  assert.equal(store.sessions().length, 0); store.close();
});
test('browse and manage commands acknowledge privately before fetching permissions', async () => {
  const { store, handler } = context(); await create(handler, store);
  const manage = interaction('command', '', { commandName: 'session', options: { getSubcommand: () => 'manage' } });
  await handler.handle(manage.raw); assert.equal(manage.events[0], 'defer'); assert.ok(manage.replies[0].embeds);
  const browse = interaction('command', '', { commandName: 'sessions', options: { getString: (name: string) => name === 'playstyle' ? 'Building / FOBs' : null } });
  await handler.handle(browse.raw); assert.equal(browse.events[0], 'defer'); assert.ok(browse.replies[0].embeds); store.close();
});
test('deferred command errors resolve the thinking placeholder with editReply', async () => {
  const { store, handler } = context();
  const manage = interaction('command', '', { commandName: 'session', options: { getSubcommand: () => 'manage' } });
  await handler.handle(manage.raw);
  assert.equal(manage.events[0], 'defer');
  assert.equal(manage.events.at(-1), 'edit');
  assert.match(manage.replies[0].content!, /no active entry/);
  store.close();
});
test('show ID works while session is in publishing state', async () => {
  const { store, handler } = context();
  const session = await create(handler, store);
  session.state = 'publishing'; store.putSession(session);
  const showId = interaction('button', `s:id:${session.id}`);
  await handler.handle(showId.raw);
  assert.equal(showId.events[0], 'defer');
  assert.match(showId.replies[0].content!, /00012/);
  store.close();
});
