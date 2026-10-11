import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ATMOSPHERES, PLAYSTYLES } from './domain.js';

export const commands = [
  new SlashCommandBuilder().setName('board').setDescription('Configure the playing-group board')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Set the normal text channel used for session cards')
      .addChannelOption(o => o.setName('channel').setDescription('Session board channel').setRequired(true).addChannelTypes(ChannelType.GuildText))),
  new SlashCommandBuilder().setName('session').setDescription('Create or manage your playing group').setDMPermission(false)
    .addSubcommand(s => s.setName('create').setDescription('Publish where your group is playing'))
    .addSubcommand(s => s.setName('manage').setDescription('Find your active entry and its controls')),
  new SlashCommandBuilder().setName('sessions').setDescription('Find active groups by playstyle and atmosphere').setDMPermission(false)
    .addStringOption(o => o.setName('atmosphere').setDescription('Atmosphere').addChoices(...ATMOSPHERES.map(v => ({ name: v, value: v }))))
    .addStringOption(o => o.setName('playstyle').setDescription('Playstyle').addChoices(...PLAYSTYLES.map(v => ({ name: v, value: v }))))
    .addStringOption(o => o.setName('language').setDescription('Language (exact match, ignoring case)').setMaxLength(40)),
].map(c => c.toJSON());
