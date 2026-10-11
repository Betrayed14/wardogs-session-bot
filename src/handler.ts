import { ChannelType, MessageFlags, PermissionFlagsBits, type Client, type GuildMember,
  type Interaction, type RepliableInteraction, type TextChannel } from 'discord.js';
import { ATMOSPHERES, FACTIONS, MICROPHONES, PLAYSTYLES, DRAFT_MS, UserError, authorize, id, initialDetails,
  noMentions, validateChoice, validateTags, type Draft } from './domain.js';
import { Store } from './store.js';
import { DiscordTransport, validateVoice } from './discord.js';
import { browseMessage, card, detailsModal, preview } from './ui.js';
import { Serial, Worker, errorCode, log } from './worker.js';

export class Handler {
  constructor(readonly client: Client, readonly store: Store, readonly transport: DiscordTransport,
    readonly worker: Worker, readonly serial: Serial) {}
  async handle(interaction: Interaction) {
    if (!interaction.isRepliable()) return;
    try {
      // Opening a modal must be the initial response, so do it without waiting on network work.
      if ((interaction.isChatInputCommand() && interaction.commandName === 'session' && interaction.options.getSubcommand() === 'create') ||
        (interaction.isButton() && interaction.customId === 'board:create')) {
        if (!interaction.guildId) throw new UserError('Create sessions in your Discord server.');
        if (!this.store.board(interaction.guildId)) throw new UserError('An administrator must first run /board setup channel:#servers.');
        const active = this.store.active(interaction.guildId, interaction.user.id);
        if (active && active.expiresAt > Date.now()) throw new UserError('You already have an entry. Use /session manage.');
        const draft = this.modalSeed(interaction.guildId, interaction.user.id);
        await interaction.showModal(detailsModal(draft).setCustomId('f:new')); return;
      }
      if (interaction.isButton() && /^s:edit:/.test(interaction.customId)) {
        const session = this.store.requiredSession(interaction.customId.split(':')[2]);
        const guildId = interaction.guildId ?? session.guildId;
        authorize(session, guildId, interaction.user.id);
        if (session.state !== 'active' || session.expiresAt <= Date.now()) throw new UserError('This entry has closed. Create a new session.');
        await interaction.showModal(detailsModal({ ...this.modalSeed(guildId, interaction.user.id), sessionId: session.id, details: session.details })
          .setCustomId(`f:edit:${session.id}:${session.revision}`)); return;
      }
      if (interaction.isButton() && /^d:fields:/.test(interaction.customId)) {
        const draftId = interaction.customId.split(':')[2];
        const guildId = interaction.guildId ?? this.store.peekDraft(draftId)?.guildId;
        if (!guildId) throw new UserError('Draft not found.');
        await interaction.showModal(detailsModal(this.store.draft(draftId, guildId, interaction.user.id, Date.now()))); return;
      }
      if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        // Updating private editor/results messages avoids accumulating ephemeral responses.
        if (interaction.customId.startsWith('d:') || interaction.customId.startsWith('b:')) await interaction.deferUpdate();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.serial.run(() => this.process(interaction));
    } catch (error) {
      log('command_failed', { code: errorCode(error), kind: interaction.type });
      const message = error instanceof UserError ? error.message : this.discordErrorMessage(error);
      try {
        const isUpdate = ('customId' in interaction) &&
          (interaction.customId.startsWith('d:') || interaction.customId.startsWith('b:'));
        if (interaction.replied || (interaction.deferred && isUpdate)) {
          // A followup preserves an editable draft when validation failed.
          await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
        } else if (interaction.deferred) {
          await interaction.editReply({ content: message, allowedMentions: noMentions });
        } else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
      } catch { log('error_response_failed'); }
    }
  }
  private discordErrorMessage(error: unknown) {
    const code = errorCode(error);
    if (['50001', '50013'].includes(code)) return 'The bot cannot access this channel or lacks required permissions. Ask an administrator to check View Channel, Send Messages, Embed Links, and Read Message History.';
    return 'Discord could not complete this action. Try again shortly; saved changes will be retried automatically.';
  }
  private modalSeed(guildId: string, ownerId: string): Draft {
    const now = Date.now();
    return { id: id(), guildId, ownerId, sessionId: null, baseRevision: null, details: initialDetails(), createdAt: now, expiresAt: now + DRAFT_MS };
  }
  private async access(guildId: string, userId: string): Promise<{ board: TextChannel; member: GuildMember }> {
    const config = this.store.board(guildId);
    if (!config) throw new UserError('An administrator must configure the board with /board setup.');
    const board = await this.transport.channel(config.channelId);
    let member: GuildMember;
    try { member = await board.guild.members.fetch({ user: userId, force: true, cache: false }); }
    catch { throw new UserError('You must still be a member of the Discord server.'); }
    if (!board.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) throw new UserError('You cannot view this session board.');
    return { board, member };
  }
  private async process(i: RepliableInteraction) {
    const now = Date.now(); this.store.sweep(now);
    if (i.isChatInputCommand()) {
      if (!i.guildId) throw new UserError('Use this command in a Discord server.');
      if (i.commandName === 'board') {
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError('Board setup requires Manage Guild.');
        const selected = i.options.getChannel('channel', true);
        if (selected.type !== ChannelType.GuildText) throw new UserError('Choose a normal text channel.');
        const result = await this.transport.setup(i.guildId, selected.id);
        await i.editReply({ content: `Session board configured in <#${result.channelId}>.`, allowedMentions: noMentions }); return;
      }
      await this.access(i.guildId, i.user.id);
      if (i.commandName === 'session') {
        const session = this.store.active(i.guildId, i.user.id);
        if (!session) throw new UserError('You have no active entry. Use /session create.');
        if (session.state === 'publishing') {
          await i.editReply({ content: 'Your entry is waiting for Discord synchronization. You can end it using the controls below.', components: card(session).components });
        } else await i.editReply(card(session));
        return;
      }
      if (i.commandName === 'sessions') {
        const view = this.store.createBrowse(i.guildId, i.user.id, {
          atmosphere: i.options.getString('atmosphere') ?? undefined,
          playstyle: i.options.getString('playstyle') ?? undefined,
          language: i.options.getString('language')?.trim() || undefined,
        }, now);
        await i.editReply(browseMessage(view, this.store.results(view, now))); return;
      }
      throw new UserError('Unknown command.');
    }
    if (i.isModalSubmit()) {
      const parts = i.customId.split(':');
      let guildId = i.guildId;
      if (parts[0] === 'f' && parts[1] === 'edit') guildId ??= this.store.session(parts[2])?.guildId ?? null;
      if (parts[0] === 'd') guildId ??= this.store.peekDraft(parts[2])?.guildId ?? null;
      if (!guildId) throw new UserError('Use this form in your Discord server.');
      await this.access(guildId, i.user.id);
      let draft: Draft;
      if (parts[0] === 'f') {
        if (!['new', 'edit'].includes(parts[1])) throw new UserError('Unknown form.');
        draft = this.store.createDraft(guildId, i.user.id, now, parts[1] === 'edit' ? parts[2] : undefined);
        if (parts[1] === 'edit' && draft.baseRevision !== Number(parts[3])) {
          this.store.deleteDraft(draft.id); throw new UserError('The session changed while this form was open. Reopen /session manage.');
        }
      } else if (parts[0] === 'd' && parts[1] === 'text') draft = this.store.draft(parts[2], guildId, i.user.id, now);
      else throw new UserError('Unknown form.');
      // Keep the input on failed validation so the private preview can reopen it for correction.
      draft.details = { ...draft.details, title: i.fields.getTextInputValue('title'), serverId: i.fields.getTextInputValue('serverId'),
        squad: i.fields.getTextInputValue('squad'), language: i.fields.getTextInputValue('language'), note: i.fields.getTextInputValue('note') };
      this.store.putDraft(draft);
      let validation = '';
      try { draft = this.store.updateText(draft.id, guildId, i.user.id, draft.details, now); }
      catch (error) { if (error instanceof UserError) validation = error.message; else throw error; }
      await i.editReply({ ...preview(draft), content: `${validation ? `${validation}\nUse Edit details to correct it.\n` : ''}${preview(draft).content}` }); return;
    }
    if (!(i.isButton() || i.isStringSelectMenu() || i.isChannelSelectMenu())) return;
    const [prefix, action, objectId] = i.customId.split(':');
    if (prefix === 'b') {
      if (!i.guildId) throw new UserError('Use /sessions in your Discord server.');
      await this.access(i.guildId, i.user.id);
      const view = this.store.browse(action, i.guildId, i.user.id, now);
      await i.editReply(browseMessage(view, this.store.results(view, now), Number(objectId))); return;
    }
    if (prefix === 'd') {
      const guildId = i.guildId ?? this.store.peekDraft(objectId)?.guildId;
      if (!guildId) throw new UserError('Draft not found.');
      const draft = this.store.draft(objectId, guildId, i.user.id, now);
      const { board } = await this.access(guildId, i.user.id);
      if (action === 'cancel') {
        this.store.deleteDraft(draft.id);
        await i.editReply({ content: 'Draft cancelled.', components: [], embeds: [] }); return;
      }
      if (action === 'publish') {
        await validateVoice(this.client, board, i.user.id, draft.details.voiceChannelId);
        const session = this.store.publish(draft.id, guildId, i.user.id, now);
        await this.worker.tick(session.id);
        const synced = this.store.requiredSession(session.id);
        if (synced.state === 'removed') throw new UserError('The board disappeared. Ask an administrator to run /board setup again.');
        const url = synced.messageId ? `https://discord.com/channels/${guildId}/${synced.channelId}/${synced.messageId}` : null;
        await i.editReply({ content: this.store.pending(session.id) ? 'Saved your session. Discord synchronization is pending and will be retried. Use /session manage for its status.' : url ? `Saved your session. [Open card](${url})` : 'Saved your session. Use /session manage for its status.',
          components: [], embeds: [], allowedMentions: noMentions }); return;
      }
      if (i.isStringSelectMenu()) {
        const values = i.values;
        if (action === 'faction') { validateChoice(values[0], FACTIONS, 'faction'); draft.details.faction = values[0]; }
        else if (action === 'microphone') { validateChoice(values[0], MICROPHONES, 'microphone preference'); draft.details.microphone = values[0]; }
        else if (action === 'atmosphere') { validateTags(values, ATMOSPHERES, 2, 'atmosphere'); draft.details.atmosphere = values; }
        else if (action === 'playstyle') { validateTags(values, PLAYSTYLES, 3, 'playstyle'); draft.details.playstyle = values; }
        else throw new UserError('Unknown selector.');
        this.store.putDraft(draft);
      } else if (i.isChannelSelectMenu() && action === 'voicepick') {
        const selected = i.values[0] ?? null;
        await validateVoice(this.client, board, i.user.id, selected);
        draft.details.voiceChannelId = selected; this.store.putDraft(draft);
      } else if (!['voice', 'main'].includes(action)) throw new UserError('Unknown draft action.');
      await i.editReply(preview(draft, ['voice', 'voicepick'].includes(action))); return;
    }
    if (prefix === 's') {
      const session = this.store.requiredSession(objectId);
      const guildId = i.guildId ?? session.guildId;
      if (guildId !== session.guildId) throw new UserError('This entry belongs to another Discord server.');
      const { board, member } = await this.access(guildId, i.user.id);
      if (i.guildId === null) authorize(session, guildId, i.user.id);
      if (action === 'id') {
        if (!['active', 'publishing'].includes(session.state) || session.expiresAt <= now) throw new UserError('This entry has closed.');
        await i.editReply({ content: `Server ID:\n\`\`\`\n${session.details.serverId}\n\`\`\`\nIn WARDOGS, open the server browser, choose Join by ID, and enter this ID. Select the faction and squad shown on the card. Availability is not verified.`, allowedMentions: noMentions }); return;
      }
      if (action === 'renew') {
        this.store.renew(session.id, guildId, i.user.id, now); await this.worker.tick(session.id);
        await i.editReply({ content: `Session renewed for two hours.${this.store.pending(session.id) ? ' The card update is pending and will be retried.' : ''}` }); return;
      }
      if (action === 'end') {
        this.store.end(session.id, guildId, i.user.id, !!board.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages), now);
        await this.worker.tick(session.id); await i.editReply({ content: 'Session ended. Its card will be removed; cleanup retries automatically if Discord is unavailable.' }); return;
      }
    }
    throw new UserError('Unknown action.');
  }
}
