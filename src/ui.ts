import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder,
  ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { ATMOSPHERES, FACTIONS, MICROPHONES, PLAYSTYLES, escapeText, noMentions, paginate,
  type Browse, type Details, type Draft, type Session } from './domain.js';

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
