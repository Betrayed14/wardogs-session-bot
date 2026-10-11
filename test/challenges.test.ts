import test from 'node:test';
import assert from 'node:assert/strict';
import { type Client, type Interaction, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { CHALLENGE_MS, UserError, type ChallengeDetails } from '../src/domain.js';
import { Store } from '../src/store.js';
import { Handler } from '../src/handler.js';
import { DiscordTransport } from '../src/discord.js';
import { Worker, Serial, type Transport } from '../src/worker.js';

const T = Date.UTC(2026, 9, 11, 15);

function validDetails(overrides: Partial<ChallengeDetails> = {}): ChallengeDetails {
  return {
    title: '4v4 Sector Clash',
    serverId: '987-654',
    type: 'Infantry Skirmish',
    rules: 'No heavy armor, infantry only.',
    targetOpponentId: null,
    ...overrides
  };
}

test('createChallenge validates input and requires a board', () => {
  const store = new Store(':memory:');
  assert.throws(() => store.createChallenge('g', 'u1', validDetails(), T), /An administrator must first configure a board/);

  store.setBoard({ guildId: 'g', channelId: 'chan-1', messageId: 'm1' });
  const ch = store.createChallenge('g', 'u1', validDetails(), T);
  assert.equal(ch.state, 'open');
  assert.equal(ch.issuerId, 'u1');
  assert.equal(ch.channelId, 'chan-1');
  assert.equal(ch.expiresAt, T + CHALLENGE_MS);

  // Validation tests
  assert.throws(() => store.createChallenge('g', 'u1', validDetails({ title: '' }), T), UserError);
  assert.throws(() => store.createChallenge('g', 'u1', validDetails({ serverId: '' }), T), UserError);
  assert.throws(() => store.createChallenge('g', 'u1', validDetails({ type: 'Invalid Type' }), T), UserError);
  store.close();
});

test('acceptChallenge prevents self-play and enforces targeted rivals', () => {
  const store = new Store(':memory:');
  store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'm' });

  // Open challenge
  const ch1 = store.createChallenge('g', 'u1', validDetails(), T);
  assert.throws(() => store.acceptChallenge(ch1.id, 'g', 'u1', T + 1000), /cannot accept your own challenge/);

  const accepted = store.acceptChallenge(ch1.id, 'g', 'u2', T + 1000);
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.opponentId, 'u2');
  assert.throws(() => store.acceptChallenge(ch1.id, 'g', 'u3', T + 2000), /no longer open/);

  // Direct targeted challenge
  const ch2 = store.createChallenge('g', 'u1', validDetails({ targetOpponentId: 'uTarget' }), T);
  assert.throws(() => store.acceptChallenge(ch2.id, 'g', 'uRandom', T + 1000), /issued directly to another player/);
  const acceptedTarget = store.acceptChallenge(ch2.id, 'g', 'uTarget', T + 1000);
  assert.equal(acceptedTarget.opponentId, 'uTarget');
  store.close();
});

test('withdrawChallenge restricts withdrawal to issuer or moderator', () => {
  const store = new Store(':memory:');
  store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'm' });
  const ch = store.createChallenge('g', 'u1', validDetails(), T);

  assert.throws(() => store.withdrawChallenge(ch.id, 'g', 'uRando', false, T), /Only the challenger or a moderator/);

  // Moderator can cancel
  const cancelledByMod = store.withdrawChallenge(ch.id, 'g', 'uMod', true, T + 500);
  assert.equal(cancelledByMod.state, 'withdrawn');
  assert.throws(() => store.withdrawChallenge(ch.id, 'g', 'u1', false, T + 600), /already concluded/);
  store.close();
});

test('reportChallenge completes matching outcomes and updates squad leaderboard', () => {
  const store = new Store(':memory:');
  store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'm' });
  const ch = store.createChallenge('g', 'u1', validDetails(), T);
  store.acceptChallenge(ch.id, 'g', 'u2', T + 1000);

  // Non-participant cannot report
  assert.throws(() => store.reportChallenge(ch.id, 'g', 'u3', 'issuer_win', T + 2000), /Only participants/);

  // Issuer reports win
  const step1 = store.reportChallenge(ch.id, 'g', 'u1', 'issuer_win', T + 2000);
  assert.equal(step1.state, 'accepted');
  assert.equal(store.leaderboard('g').length, 0); // No stats applied yet

  // Opponent confirms issuer win
  const step2 = store.reportChallenge(ch.id, 'g', 'u2', 'issuer_win', T + 3000);
  assert.equal(step2.state, 'completed');
  assert.equal(step2.winnerId, 'u1');

  // Verify leaderboard points (3 pts for win, 0 for loss)
  const board = store.leaderboard('g');
  assert.equal(board.length, 2);
  const winner = board.find(s => s.squadName === 'u1')!;
  const loser = board.find(s => s.squadName === 'u2')!;
  assert.equal(winner.wins, 1);
  assert.equal(winner.points, 3);
  assert.equal(loser.losses, 1);
  assert.equal(loser.points, 0);
  store.close();
});

test('conflicting reports cause dispute, which moderator resolves', () => {
  const store = new Store(':memory:');
  store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'm' });
  const ch = store.createChallenge('g', 'u1', validDetails(), T);
  store.acceptChallenge(ch.id, 'g', 'u2', T + 1000);

  // Conflicting reports
  store.reportChallenge(ch.id, 'g', 'u1', 'issuer_win', T + 2000);
  const disputed = store.reportChallenge(ch.id, 'g', 'u2', 'opponent_win', T + 3000);
  assert.equal(disputed.state, 'disputed');

  // Moderator resolves dispute
  const resolved = store.resolveDispute(ch.id, 'g', 'uMod', 'opponent_win', T + 4000);
  assert.equal(resolved.state, 'completed');
  assert.equal(resolved.winnerId, 'u2');

  const board = store.leaderboard('g');
  const u2Stats = board.find(s => s.squadName === 'u2')!;
  assert.equal(u2Stats.wins, 1);
  assert.equal(u2Stats.points, 3);
  store.close();
});

test('sweep transitions expired challenges', () => {
  const store = new Store(':memory:');
  store.setBoard({ guildId: 'g', channelId: 'c', messageId: 'm' });
  const ch = store.createChallenge('g', 'u1', validDetails(), T);
  assert.equal(ch.state, 'open');

  store.sweep(T + CHALLENGE_MS + 1000);
  const swept = store.challenge(ch.id)!;
  assert.equal(swept.state, 'expired');
  store.close();
});

// Interaction handler tests for challenges
type Payload = { content?: string; flags?: number; components?: unknown[]; embeds?: unknown[] };
function mockInteraction(kind: string, customId = '', overrides: Record<string, unknown> = {}) {
  const events: string[] = []; const replies: Payload[] = []; let modalId = '';
  const mock = {
    type: 2, guildId: 'g', user: { id: 'u1' }, customId, deferred: false, replied: false,
    isRepliable: () => true, isButton: () => kind === 'button', isChatInputCommand: () => kind === 'command',
    isStringSelectMenu: () => kind === 'select', isChannelSelectMenu: () => kind === 'channel', isModalSubmit: () => kind === 'modal',
    async deferReply(_payload: Payload) { events.push('defer'); mock.deferred = true; },
    async deferUpdate() { events.push('deferUpdate'); mock.deferred = true; },
    async showModal(modal: { toJSON(): { custom_id: string } }) { events.push('modal'); modalId = modal.toJSON().custom_id; mock.replied = true; },
    async reply(payload: Payload) { events.push('reply'); replies.push(payload); mock.replied = true; },
    async editReply(payload: Payload) { events.push('edit'); replies.push(payload); },
    async followUp(payload: Payload) { events.push('followup'); replies.push(payload); },
    ...overrides,
  };
  return { raw: mock as unknown as Interaction, mock, events, replies, modalId: () => modalId };
}

function handlerContext() {
  const store = new Store(':memory:');
  store.setBoard({ guildId: 'g', channelId: 'chan-c', messageId: 'board-msg' });
  let moderator = false;
  const member = { id: 'u' };
  const channel = {
    id: 'chan-c',
    guild: { members: { fetch: async () => member } },
    permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.ViewChannel | (moderator ? PermissionFlagsBits.ManageMessages : 0n)),
    send: async () => ({ id: 'card-msg-1' }),
    messages: { fetch: async () => ({ edit: async () => {} }) }
  };
  const client = {} as Client;
  const transport = {
    channel: async () => channel,
    findSession: async () => null,
    sendSession: async () => 'message',
    editSession: async () => {},
    deleteSession: async () => {},
    remind: async () => {},
    setup: async () => store.board('g')
  };
  const worker = new Worker(store, transport as Transport, () => {});
  const handler = new Handler(client, store, transport as unknown as DiscordTransport, worker, new Serial());
  return { store, handler, setModerator: (val: boolean) => { moderator = val; } };
}

test('interaction: /challenge issue, accept, show ID, report, and outcome flow', async () => {
  const { store, handler, setModerator } = handlerContext();

  // 1. Issue modal open
  const issueCmd = mockInteraction('command', '', {
    commandName: 'challenge',
    options: { getSubcommand: () => 'issue', getUser: () => null }
  });
  await handler.handle(issueCmd.raw);
  assert.equal(issueCmd.modalId(), 'c:form:new');

  // 2. Submit issue modal
  const submitModal = mockInteraction('modal', 'c:form:new', {
    user: { id: 'uChallenger' },
    fields: {
      getTextInputValue: (key: string) => {
        const data: Record<string, string> = {
          title: 'Squad Deathmatch',
          serverId: '001-999',
          type: 'Infantry Skirmish',
          rules: 'Standard Rules',
          opponent: ''
        };
        return data[key] ?? '';
      }
    }
  });
  await handler.handle(submitModal.raw);
  assert.match(submitModal.replies[0].content!, /Challenge issued!/);
  const challenges = store.challenges('g');
  assert.equal(challenges.length, 1);
  const ch = challenges[0];
  assert.equal(ch.issuerId, 'uChallenger');
  assert.equal(ch.state, 'open');

  // 3. Show server ID button
  const idBtn = mockInteraction('button', `c:id:${ch.id}`, { user: { id: 'uRival' } });
  await handler.handle(idBtn.raw);
  assert.match(idBtn.replies[0].content!, /001-999/);

  // 4. Accept challenge button
  const acceptBtn = mockInteraction('button', `c:accept:${ch.id}`, { user: { id: 'uRival' } });
  await handler.handle(acceptBtn.raw);
  assert.match(acceptBtn.replies[0].content!, /Challenge accepted!/);
  assert.equal(store.challenge(ch.id)!.state, 'accepted');

  // 5. Open report result buttons
  const reportBtn = mockInteraction('button', `c:report:${ch.id}`, { user: { id: 'uChallenger' } });
  await handler.handle(reportBtn.raw);
  assert.match(reportBtn.replies[0].content!, /Select the match outcome/);

  // 6. Challenger reports challenger win
  const reportOutcome1 = mockInteraction('button', `c:outcome:${ch.id}:issuer_win`, { user: { id: 'uChallenger' } });
  await handler.handle(reportOutcome1.raw);
  assert.match(reportOutcome1.replies[0].content!, /Waiting for the opponent to report/);

  // 7. Rival reports rival win -> Dispute
  const reportOutcome2 = mockInteraction('button', `c:outcome:${ch.id}:opponent_win`, { user: { id: 'uRival' } });
  await handler.handle(reportOutcome2.raw);
  assert.match(reportOutcome2.replies[0].content!, /Conflicting reports detected/);
  assert.equal(store.challenge(ch.id)!.state, 'disputed');

  // 8. Moderator resolves dispute
  setModerator(true);
  const modBtn = mockInteraction('button', `c:mod:${ch.id}`, { user: { id: 'uMod' } });
  await handler.handle(modBtn.raw);
  assert.match(modBtn.replies[0].content!, /Moderator dispute resolution/);

  const resolveBtn = mockInteraction('button', `c:resolve:${ch.id}:issuer_win`, { user: { id: 'uMod' } });
  await handler.handle(resolveBtn.raw);
  assert.match(resolveBtn.replies[0].content!, /Dispute resolved!/);
  assert.equal(store.challenge(ch.id)!.state, 'completed');
  assert.equal(store.challenge(ch.id)!.winnerId, 'uChallenger');

  store.close();
});
