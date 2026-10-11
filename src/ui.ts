import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder,
  ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { ATMOSPHERES, FACTIONS, MICROPHONES, PLAYSTYLES, escapeText, noMentions, paginate,
  type Browse, type Challenge, type Details, type Draft, type Session, type SquadStats } from './domain.js';

export function button(customId: string, label: string, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}
export function sessionControls(sessionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`s:id:${sessionId}`, 'Show ID'), button(`s:edit:${sessionId}`, 'Edit'),
    button(`s:renew:${sessionId}`, 'Still playing', ButtonStyle.Success),
    button(`s:end:${sessionId}`, 'End session', ButtonStyle.Danger));
}
export const boardMarker = (guildId: string) => `WARDOGS_BOARD:${guildId}`;
export const sessionMarker = (sessionId: string) => `Session ${sessionId}`;
export function boardMessage(guildId: string) {
  return { embeds: [new EmbedBuilder().setTitle('Where are we playing?').setColor(0x5865f2)
    .setDescription('Starting a group? Create an entry with your server ID and playstyle tags. Joining a group? Use its existing card. Entries expire after two hours unless the creator renews them.\n\nUse /sessions to filter active groups. Details are supplied by players; game availability and attendance are not verified.')
    .setFooter({ text: boardMarker(guildId) })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button('board:create', 'Create session', ButtonStyle.Primary))], allowedMentions: noMentions };
}
function detailsEmbed(details: Details) {
  const safe = escapeText;
  return new EmbedBuilder().setColor(0x5865f2).setTitle(safe(details.title || 'Session preview'))
    .addFields(
      { name: 'Server ID', value: details.serverId ? `\`\`\`\n${details.serverId.replace(/[`\r\n]/g, '').replace(/@/g, '@\u200b')}\n\`\`\`` : 'Not entered', inline: false },
      { name: 'Faction', value: details.faction || 'Choose a faction', inline: true },
      { name: 'Squad', value: safe(details.squad) || 'Not specified', inline: true },
      { name: 'Atmosphere', value: details.atmosphere.join(' · ') || 'Choose tags' },
      { name: 'Playstyle', value: details.playstyle.join(' · ') || 'Choose tags' },
      { name: 'Language', value: safe(details.language) || 'Not entered', inline: true },
      { name: 'Microphone', value: details.microphone, inline: true },
      { name: 'Discord voice', value: details.voiceChannelId ? `<#${details.voiceChannelId}>` : 'Not specified', inline: true })
    .setDescription(safe(details.note) || 'No additional note.');
}
export function card(session: Session) {
  return { embeds: [detailsEmbed(session.details)
    .addFields({ name: 'Creator', value: `<@${session.ownerId}>`, inline: true },
      { name: 'Last confirmed', value: `<t:${Math.floor(session.confirmedAt / 1000)}:R>`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(session.expiresAt / 1000)}:R>`, inline: true })
    .setFooter({ text: sessionMarker(session.id) })], components: [sessionControls(session.id)], allowedMentions: noMentions };
}
export function detailsModal(draft: Draft) {
  const modal = new ModalBuilder().setCustomId(`d:text:${draft.id}`).setTitle(draft.sessionId ? 'Edit playing group' : 'Create playing group');
  for (const field of [
    { key: 'title', label: 'Group title', max: 80, required: true },
    { key: 'serverId', label: 'Numerical server ID (or community UUID)', max: 64, required: true },
    { key: 'squad', label: 'Squad name (optional)', max: 60, required: false },
    { key: 'language', label: 'Language', max: 40, required: true },
    { key: 'note', label: 'Short note (optional)', max: 300, required: false },
  ] as const) {
    const input = new TextInputBuilder().setCustomId(field.key).setLabel(field.label).setMaxLength(field.max)
      .setRequired(field.required).setStyle(field.key === 'note' ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (draft.details[field.key]) input.setValue(draft.details[field.key]);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return modal;
}
function select(draftId: string, field: string, placeholder: string, options: readonly string[], selected: string[], max = 1) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`d:${field}:${draftId}`).setPlaceholder(placeholder).setMinValues(1).setMaxValues(max)
    .addOptions(options.map(value => ({ label: value, value, default: selected.includes(value) }))));
}
export function preview(draft: Draft, voiceView = false) {
  const d = draft.details;
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`d:publish:${draft.id}`, draft.sessionId ? 'Save changes' : 'Publish', ButtonStyle.Primary),
    button(`d:fields:${draft.id}`, 'Edit details'),
    button(`d:${voiceView ? 'main' : 'voice'}:${draft.id}`, voiceView ? 'Back to tags' : 'Voice channel'),
    button(`d:cancel:${draft.id}`, 'Cancel', ButtonStyle.Danger));
  const selectors = voiceView ? [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(`d:voicepick:${draft.id}`).setPlaceholder('Optional voice channel (clear to remove)')
      .setChannelTypes(ChannelType.GuildVoice).setMinValues(0).setMaxValues(1)
      .setDefaultChannels(...(d.voiceChannelId ? [d.voiceChannelId] : [])))] : [
    select(draft.id, 'faction', 'Faction', FACTIONS, [d.faction]),
    select(draft.id, 'atmosphere', 'Atmosphere — choose 1 or 2', ATMOSPHERES, d.atmosphere, 2),
    select(draft.id, 'playstyle', 'Playstyle — choose 1 to 3', PLAYSTYLES, d.playstyle, 3),
    select(draft.id, 'microphone', 'Microphone preference', MICROPHONES, [d.microphone]),
  ];
  return { content: `Private preview • draft expires <t:${Math.floor(draft.expiresAt / 1000)}:R>. ${draft.sessionId ? 'Saving does not renew the session.' : 'Publish when ready.'}`,
    embeds: [detailsEmbed(d)], components: [...selectors, controls], allowedMentions: noMentions };
}
export function browseMessage(view: Browse, sessions: Session[], requestedPage = 0) {
  const page = paginate(sessions, requestedPage);
  const description = page.items.map(s => {
    const url = `https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId}`;
    return `**${escapeText(s.details.title)}**\n${s.details.atmosphere.join(' · ')} | ${s.details.playstyle.join(' · ')}\n${escapeText(s.details.language)} · ${s.details.faction} · [Open card](${url})`;
  }).join('\n\n') || 'No active groups match these filters.';
  return { embeds: [new EmbedBuilder().setTitle('Active playing groups').setDescription(description)
    .setFooter({ text: `${page.total} groups · Page ${page.page + 1}/${page.pages}` })],
    components: page.pages > 1 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(`b:${view.id}:${page.page - 1}`, 'Previous').setDisabled(page.page === 0),
      button(`b:${view.id}:${page.page + 1}`, 'Next').setDisabled(page.page === page.pages - 1))] : [], allowedMentions: noMentions };
}
export const challengeMarker = (id: string) => `Challenge ${id}`;

export function challengeControls(ch: Challenge) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (ch.state === 'open') {
    row.addComponents(
      button(`c:accept:${ch.id}`, 'Accept Challenge', ButtonStyle.Success),
      button(`c:cancel:${ch.id}`, 'Withdraw', ButtonStyle.Danger),
      button(`c:id:${ch.id}`, 'Show Server ID')
    );
  } else if (ch.state === 'accepted') {
    row.addComponents(
      button(`c:report:${ch.id}`, 'Report Result', ButtonStyle.Primary),
      button(`c:cancel:${ch.id}`, 'Cancel', ButtonStyle.Danger),
      button(`c:id:${ch.id}`, 'Show Server ID')
    );
  } else if (ch.state === 'disputed') {
    row.addComponents(
      button(`c:mod:${ch.id}`, 'Resolve Dispute', ButtonStyle.Danger),
      button(`c:id:${ch.id}`, 'Show Server ID')
    );
  } else {
    row.addComponents(button(`c:id:${ch.id}`, 'Show Server ID'));
  }
  return row;
}

export function challengeCard(ch: Challenge) {
  const safe = escapeText;
  const statusColors: Record<Challenge['state'], number> = {
    open: 0x5865f2,
    accepted: 0xe67e22,
    completed: 0x2ecc71,
    disputed: 0xe74c3c,
    withdrawn: 0x95a5a6,
    expired: 0x7f8c8d
  };
  const statusLabels: Record<Challenge['state'], string> = {
    open: '⚔️ Open Challenge',
    accepted: '🔥 In Progress',
    completed: '🏆 Completed',
    disputed: '⚠️ Disputed (Awaiting Moderator)',
    withdrawn: 'Cancelled',
    expired: 'Expired'
  };
  const embed = new EmbedBuilder()
    .setColor(statusColors[ch.state])
    .setTitle(safe(ch.details.title))
    .setDescription(safe(ch.details.rules) || 'Standard community rules.')
    .addFields(
      { name: 'Status', value: statusLabels[ch.state], inline: true },
      { name: 'Type', value: ch.details.type, inline: true },
      { name: 'Server ID', value: `\`\`\`\n${ch.details.serverId.replace(/[`\r\n]/g, '')}\n\`\`\``, inline: false },
      { name: 'Challenger', value: `<@${ch.issuerId}>`, inline: true },
      { name: 'Opponent', value: ch.opponentId ? `<@${ch.opponentId}>` : (ch.details.targetOpponentId ? `<@${ch.details.targetOpponentId}> (Direct)` : 'Open to anyone'), inline: true }
    );
  if (ch.state === 'completed') {
    embed.addFields({ name: 'Winner', value: ch.winnerId === 'draw' ? 'Draw' : `<@${ch.winnerId}>`, inline: true });
  } else if (ch.state === 'accepted') {
    const reported = Object.keys(ch.reports);
    embed.addFields({ name: 'Reports', value: reported.length ? `${reported.length}/2 participants reported` : 'Match in progress — report result when done', inline: false });
  }
  embed.setFooter({ text: challengeMarker(ch.id) });
  return { embeds: [embed], components: [challengeControls(ch)], allowedMentions: noMentions };
}

export function challengeModal(targetOpponentId?: string) {
  const modal = new ModalBuilder().setCustomId('c:form:new').setTitle('Issue Community Challenge');
  const title = new TextInputBuilder().setCustomId('title').setLabel('Challenge title').setPlaceholder('e.g. 4v4 Outpost Skirmish').setMaxLength(80).setRequired(true).setStyle(TextInputStyle.Short);
  const serverId = new TextInputBuilder().setCustomId('serverId').setLabel('Server ID (numerical or UUID)').setPlaceholder('e.g. 001-002').setMaxLength(64).setRequired(true).setStyle(TextInputStyle.Short);
  const type = new TextInputBuilder().setCustomId('type').setLabel('Type (Infantry Skirmish / FOB Race...)').setValue('Infantry Skirmish').setMaxLength(40).setRequired(true).setStyle(TextInputStyle.Short);
  const rules = new TextInputBuilder().setCustomId('rules').setLabel('Rules / conditions (optional)').setPlaceholder('e.g. No air vehicles, capture Objective A').setMaxLength(300).setRequired(false).setStyle(TextInputStyle.Paragraph);
  const opponent = new TextInputBuilder().setCustomId('opponent').setLabel('Rival User ID (optional, blank = open)').setPlaceholder('Leave blank for open challenge').setMaxLength(32).setRequired(false).setStyle(TextInputStyle.Short);
  if (targetOpponentId) opponent.setValue(targetOpponentId);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(title),
    new ActionRowBuilder<TextInputBuilder>().addComponents(serverId),
    new ActionRowBuilder<TextInputBuilder>().addComponents(type),
    new ActionRowBuilder<TextInputBuilder>().addComponents(rules),
    new ActionRowBuilder<TextInputBuilder>().addComponents(opponent)
  );
  return modal;
}

export function reportResultButtons(challengeId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`c:outcome:${challengeId}:issuer_win`, 'Challenger Won', ButtonStyle.Success),
    button(`c:outcome:${challengeId}:opponent_win`, 'Opponent Won', ButtonStyle.Primary),
    button(`c:outcome:${challengeId}:draw`, 'Draw / Tie', ButtonStyle.Secondary)
  );
}

export function leaderboardMessage(stats: SquadStats[]) {
  const description = stats.map((s, idx) => {
    return `**${idx + 1}. <@${s.squadName}>** — **${s.points} pts**\nWins: ${s.wins} | Losses: ${s.losses} | Draws: ${s.draws}`;
  }).join('\n\n') || 'No challenge results recorded yet. Issue a challenge to get on the leaderboard!';
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏆 Community Challenge Leaderboard')
    .setDescription(description)
    .setFooter({ text: '3 pts per win · 1 pt per draw' });
  return { embeds: [embed], components: [], allowedMentions: noMentions };
}

export function helpMessage(topic: string = 'all') {
  if (topic === 'sessions') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎮 Playing Groups (LFG) Guide')
      .setDescription('How to post, find, and join playing groups on official WARDOGS servers.')
      .addFields(
        {
          name: '1. Posting a Session',
          value: '• Click **Create session** on the board channel, or run `/session create`.\n• Enter your **Title**, **Server ID**, **Squad name**, **Language**, and optional **Note**.\n• In the private preview, choose **Faction**, **Atmosphere**, **Playstyle**, **Microphone**, and optional **Voice channel**.\n• Click **Publish** to post your card to the board channel.'
        },
        {
          name: '2. Card Controls & Expiration',
          value: '• **Show ID**: Privately reveals the in-game server ID without leaving Discord.\n• **Still playing**: Renews your card for another 2 hours. Cards expire in 2 hours if not renewed.\n• **Edit**: Reopen the text form to update squad, title, or notes.\n• **End session**: Immediately closes your group and removes the card.\n• **DM Reminders**: The bot sends a private DM reminder 15 minutes before expiry with quick renewal buttons.'
        },
        {
          name: '3. Searching & Managing',
          value: '• `/sessions atmosphere:Chill playstyle:Infantry language:English`: Search active cards with instant filters.\n• `/session manage`: Open controls for your currently active card if you lost track of it.'
        }
      )
      .setFooter({ text: 'Use /help for the main guide.' });
    return { embeds: [embed], components: [], allowedMentions: noMentions };
  }

  if (topic === 'challenges') {
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('⚔️ Community Challenges & Duels Guide')
      .setDescription('How to issue scrims, challenge rival squads, report results, and compete on the leaderboard.')
      .addFields(
        {
          name: '1. Issuing a Challenge',
          value: '• Run `/challenge issue`.\n• *(Optional)* Tag a rival user in `opponent` for a direct duel, or leave empty for an open community challenge.\n• Enter Title, Server ID, Skirmish Type (e.g. *Infantry Skirmish*, *FOB Race*, *Armor Duel*), and custom Rules.'
        },
        {
          name: '2. Accepting & Connecting',
          value: '• Any member (or the designated rival) clicks **Accept Challenge** on the card.\n• Click **Show Server ID** to reveal the in-game server ID.\n• In WARDOGS, open the Server Browser, choose **Join by ID**, and connect!'
        },
        {
          name: '3. Reporting Results & Disputes',
          value: '• When the battle finishes, both participants click **Report Result** and choose the winner or draw.\n• **Consensus**: When both reports agree, the card displays the winner and awards points!\n• **Dispute**: Conflicting reports flag the card as **⚠️ Disputed**, unlocking a **Resolve Dispute** panel for moderators.'
        },
        {
          name: '4. Leaderboard & Points',
          value: '• **Win**: +3 points | **Draw**: +1 point | **Loss**: 0 points\n• Run `/challenge leaderboard` to see the top ranked squads and players in the server.'
        }
      )
      .setFooter({ text: 'Use /help for the main guide.' });
    return { embeds: [embed], components: [], allowedMentions: noMentions };
  }

  if (topic === 'admin') {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('⚙️ Administration & Moderation Guide')
      .setDescription('Channel setup instructions, bot permissions, and moderation workflows.')
      .addFields(
        {
          name: '1. Channel Setup Commands',
          value: '• `/board setup channel:#lfg-sessions`: Sets the channel where session cards are posted. *(Requires Manage Guild)*\n• `/challenge setup channel:#challenges`: Sets a dedicated channel for community challenges. If omitted, challenges post to the session board. *(Requires Manage Guild)*'
        },
        {
          name: '2. Required Bot Permissions',
          value: 'The bot requires standard channel permissions (integer `85056`):\n• **View Channel**, **Send Messages**, **Embed Links**, **Read Message History**\n• **Zero privileged Gateway intents** needed! No Administrator permission required.'
        },
        {
          name: '3. Moderation Controls',
          value: '• **End Sessions**: Members with `Manage Messages` in the board channel can click **End session** on any inappropriate card to delete it.\n• **Dispute Settlement**: Members with `Manage Messages` can click **Resolve Dispute** on disputed challenge cards to make the official ruling.'
        },
        {
          name: '4. Backups & Safety',
          value: '• Automatic daily atomic SQLite WAL backups with 7-day rotation.\n• Manual backups via `npm run backup`.'
        }
      )
      .setFooter({ text: 'Use /help for the main guide.' });
    return { embeds: [embed], components: [], allowedMentions: noMentions };
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📖 WARDOGS Bot — Commands & Features Guide')
    .setDescription('Welcome to the WARDOGS Session & Challenge Bot! Below is a quick overview of all commands and features. Use `/help topic:<name>` for in-depth guides.')
    .addFields(
      {
        name: '🎮 Playing Groups (LFG)',
        value: '• `/session create` — Post where your group is playing\n• `/session manage` — Reopen controls for your active card\n• `/sessions [filters]` — Search active groups (atmosphere, playstyle, language)\n• *Board Button* — Click **Create session** directly in the board channel'
      },
      {
        name: '⚔️ Community Challenges & Duels',
        value: '• `/challenge issue [opponent]` — Issue an open challenge or squad duel\n• `/challenge list` — List open and active skirmishes\n• `/challenge leaderboard` — View ranked community scores (+3 win, +1 draw)\n• *Reporting* — Dual-confirmation reporting with moderator dispute resolution'
      },
      {
        name: '⚙️ Server Administration',
        value: '• `/board setup channel:#chan` — Configure the session board channel\n• `/challenge setup channel:#chan` — Configure dedicated challenge channel'
      },
      {
        name: '💡 Quick Help Topics',
        value: '• `/help topic:sessions` — Detailed guide to LFG cards & controls\n• `/help topic:challenges` — Detailed guide to challenges & scoring\n• `/help topic:admin` — Permissions, channel configuration & moderation'
      }
    )
    .setFooter({ text: 'WARDOGS Session Bot · 3 pts per win · 1 pt per draw' });
  return { embeds: [embed], components: [], allowedMentions: noMentions };
}

