import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { requiredEnv } from './config.js';
import { errorCode, log } from './worker.js';

const token = requiredEnv('DISCORD_TOKEN');
const app = requiredEnv('DISCORD_APPLICATION_ID');
const guild = requiredEnv('DISCORD_GUILD_ID');
try {
  await new REST({ version: '10' }).setToken(token).put(Routes.applicationGuildCommands(app, guild), { body: commands });
  log('commands_registered', { guildId: guild });
} catch (error) { log('registration_failed', { code: errorCode(error) }); process.exitCode = 1; }
