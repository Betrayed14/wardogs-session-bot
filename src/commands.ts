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
  new SlashCommandBuilder().setName('challenge').setDescription('Issue or browse community challenges and leaderboard').setDMPermission(false)
    .addSubcommand(s => s.setName('issue').setDescription('Issue a new challenge to community members')
      .addStringOption(o => o.setName('activity').setDescription('Activity type (Grenade Kills, C4 Kills, Helis, etc.)').setRequired(false)
        .addChoices(
          { name: '💣 Grenade Kills', value: 'Grenade Kills' },
          { name: '💥 C4 Explosive Kills', value: 'C4 Explosive Kills' },
          { name: '🚐 Spawn Vehicles Destroyed', value: 'Spawn Vehicles Destroyed' },
          { name: '🚜 Vehicles Destroyed', value: 'Vehicles Destroyed' },
          { name: '🚁 Helicopters Destroyed', value: 'Helicopters Destroyed' },
          { name: '🎯 Hotzone Kills', value: 'Hotzone Kills' },
          { name: '⚔️ Infantry Frags', value: 'Infantry Frags' },
          { name: '🔥 Combat Killstreak', value: 'Combat Killstreak' },
          { name: '🩺 Combat Revives', value: 'Combat Revives' },
          { name: '❤️‍🩹 Hotzone Rescues', value: 'Hotzone Rescues' },
          { name: '🏗️ FOBs Deployed', value: 'FOBs Deployed' },
          { name: '🧱 Fortifications Built', value: 'Fortifications Built' },
          { name: '🧨 Enemy FOBs Demolished', value: 'Enemy FOBs Demolished' },
          { name: '📦 Supplies Delivered', value: 'Supplies Delivered' },
          { name: '🔭 Long-Range Sniper Kills', value: 'Long-Range Sniper Kills' },
          { name: '👁️ Targets Spotted', value: 'Targets Spotted' },
          { name: '🪂 Hotzone Troop Drops', value: 'Hotzone Troop Drops' },
          { name: '💰 Match Cash Earned', value: 'Match Cash Earned' },
          { name: '🎖️ Bounties Claimed', value: 'Bounties Claimed' },
        ))
      .addIntegerOption(o => o.setName('target').setDescription('Target goal to win (e.g. 5 or 10; leave empty for high score duel)').setRequired(false).setMinValue(1).setMaxValue(100000))
      .addUserOption(o => o.setName('opponent').setDescription('Target opponent (optional, leave empty for open challenge)').setRequired(false)))
    .addSubcommand(s => s.setName('list').setDescription('List active and open challenges'))
    .addSubcommand(s => s.setName('leaderboard').setDescription('View community challenge rankings'))
    .addSubcommand(s => s.setName('setup').setDescription('Configure dedicated channel for challenge cards')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for challenge cards').setRequired(true).addChannelTypes(ChannelType.GuildText))),
  new SlashCommandBuilder().setName('help').setDescription('Learn how to use WARDOGS bot commands and features').setDMPermission(false)
    .addStringOption(o => o.setName('topic').setDescription('Specific topic to learn about').setRequired(false)
      .addChoices(
        { name: 'Overview / All Topics', value: 'all' },
        { name: 'Playing Groups (LFG)', value: 'sessions' },
        { name: 'Community Challenges & Duels', value: 'challenges' },
        { name: 'Administration & Setup', value: 'admin' },
      )),
].map(c => c.toJSON());
