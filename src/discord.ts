import { ChannelType, Client, PermissionFlagsBits, type GuildMember, type TextChannel, type VoiceChannel } from 'discord.js';
import { type Board, type Session, UserError, noMentions } from './domain.js';
import { boardMarker, boardMessage, card, sessionControls, sessionMarker } from './ui.js';
import { Store } from './store.js';
import { type Transport } from './worker.js';

export const BOARD_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
export function requireBoardPermissions(channel: TextChannel, member: GuildMember) {
  if (!channel.permissionsFor(member)?.has(BOARD_PERMISSIONS))
    throw new UserError('The bot needs View Channel, Send Messages, Embed Links, and Read Message History in the board channel. Ask an administrator to grant them.');
}
export async function validateVoice(client: Client, board: TextChannel, userId: string, voiceId: string | null) {
  if (!voiceId) return;
  const voice = await board.guild.channels.fetch(voiceId);
  if (!voice || voice.type !== ChannelType.GuildVoice) throw new UserError('Select an existing ordinary voice channel in this Discord server.');
  const requester = await board.guild.members.fetch({ user: userId, force: true, cache: false });
  const me = await board.guild.members.fetchMe({ force: true });
  if (!voice.permissionsFor(requester)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]) ||
    !voice.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel))
    throw new UserError('You must be able to view and join the voice channel, and the bot must be able to view it.');
  if (!client.user) throw new UserError('The bot is not ready yet.');
  assertAudienceVoice(board, voice);
}
/** Conservative role-level proof; never enumerate members or require privileged member intent. */
export function assertAudienceVoice(board: TextChannel, voice: VoiceChannel) {
  const access = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];
  // Reject restrictive non-everyone overwrites. Discord combines multiple roles; individually comparing roles would miss combinations.
  if ([...voice.permissionOverwrites.cache.values()].some(o => o.id !== voice.guild.id &&
    (o.deny.has(PermissionFlagsBits.ViewChannel) || o.deny.has(PermissionFlagsBits.Connect))))
    throw new UserError('This voice channel has restrictive member or role overrides. Choose a voice channel open to the board audience.');
  for (const role of board.guild.roles.cache.values()) {
    if (board.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel) && !voice.permissionsFor(role)?.has(access))
      throw new UserError('The voice channel must be visible and joinable to the board audience.');
  }
  // Member-specific board grants cannot be safely proved without member enumeration; require everyone access in that case.
  if ([...board.permissionOverwrites.cache.values()].some(o => o.type === 1 && o.allow.has(PermissionFlagsBits.ViewChannel)) &&
    !voice.permissionsFor(voice.guild.roles.everyone)?.has(access))
    throw new UserError('Choose a public voice channel when the board uses member-specific visibility grants.');
}
export class DiscordTransport implements Transport {
  constructor(readonly client: Client, readonly store: Store) {}
  async channel(channelId: string): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) throw new UserError('The configured board must be an existing normal text channel.');
    const me = await channel.guild.members.fetchMe({ force: true }); requireBoardPermissions(channel, me); return channel;
  }
  async findSession(session: Session) {
    const channel = await this.channel(session.channelId);
    return this.findMarker(channel, sessionMarker(session.id), session.createdAt - 5_000);
  }
  private async findMarker(channel: TextChannel, marker: string, cutoff = 0) {
    let before: string | undefined;
    for (;;) {
      const batch = await channel.messages.fetch({ limit: 100, before, cache: false });
      for (const message of batch.values()) {
        if (message.author.id === this.client.user?.id && message.embeds.some(e => e.footer?.text === marker)) return message.id;
      }
      const oldest = batch.last();
      if (!oldest || batch.size < 100 || oldest.createdTimestamp < cutoff) return null;
      before = oldest.id;
    }
  }
  async sendSession(session: Session) {
    const channel = await this.channel(session.channelId);
    await this.ensureVoice(session, channel);
    const message = await channel.send({ ...card(session), nonce: session.nonce, enforceNonce: true });
    return message.id;
  }
  async editSession(session: Session) {
    const channel = await this.channel(session.channelId);
    await this.ensureVoice(session, channel);
    const message = await channel.messages.fetch(session.messageId!);
    await message.edit(card(session));
  }
  private async ensureVoice(session: Session, channel: TextChannel) {
    if (!session.details.voiceChannelId) return;
    // Permissions can change after publication: clear invalid voice references rather than expose inaccessible channels.
    try { await validateVoice(this.client, channel, session.ownerId, session.details.voiceChannelId); }
    catch (error) {
      if (!(error instanceof UserError) && !(typeof error === 'object' && error && 'code' in error && ['10003', '10007'].includes(String(error.code)))) throw error;
      session.details.voiceChannelId = null; this.store.putSession(session);
    }
  }
  async deleteSession(session: Session) {
    const channel = await this.channel(session.channelId);
    await channel.messages.delete(session.messageId!);
  }
  async remind(session: Session) {
    const user = await this.client.users.fetch(session.ownerId);
    await user.send({ content: `Your WARDOGS playing-group entry expires in about 15 minutes. Still playing? Renew it below.\nhttps://discord.com/channels/${session.guildId}/${session.channelId}/${session.messageId}`,
      components: [sessionControls(session.id)], allowedMentions: noMentions });
  }
  async setup(guildId: string, channelId: string): Promise<Board> {
    const channel = await this.channel(channelId);
    if (channel.guild.id !== guildId) throw new UserError('Choose a channel in this Discord server.');
    const previous = this.store.board(guildId);
    if (previous && previous.channelId !== channelId) {
      if (this.store.sessions(guildId).some(s => ['active', 'publishing'].includes(s.state)))
        throw new UserError('End active sessions before moving the board to another channel.');
      if (previous.messageId) {
        try {
          const oldChan = await this.client.channels.fetch(previous.channelId);
          if (oldChan?.type === ChannelType.GuildText) await oldChan.messages.delete(previous.messageId);
        } catch { /* best effort cleanup of old board message */ }
      }
    }
    let messageId = await this.findMarker(channel, boardMarker(guildId));
    if (messageId) {
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit(boardMessage(guildId));
      } catch {
        messageId = (await channel.send(boardMessage(guildId))).id;
      }
    } else messageId = (await channel.send(boardMessage(guildId))).id;
    const board = { guildId, channelId, messageId }; this.store.setBoard(board); return board;
  }
}
