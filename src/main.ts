import { Client, Events, GatewayIntentBits } from 'discord.js';
import { Store } from './store.js';
import { Handler } from './handler.js';
import { DiscordTransport } from './discord.js';
import { Serial, Worker, errorCode, log } from './worker.js';
import { backupDirectory, databasePath, requiredEnv } from './config.js';

const token = requiredEnv('DISCORD_TOKEN');
const store = new Store(databasePath());
const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [], repliedUser: false },
  rest: { timeout: 10_000, retries: 2 } });
const serial = new Serial();
const transport = new DiscordTransport(client, store);
const worker = new Worker(store, transport, log, Date.now, backupDirectory());
const handler = new Handler(client, store, transport, worker, serial);
let timer: ReturnType<typeof setInterval> | undefined;
client.once(Events.ClientReady, () => {
  log('ready');
  let pending = false;
  const tick = () => {
    if (pending) return Promise.resolve();
    pending = true;
    return serial.run(() => worker.tick()).catch(error => log('worker_failed', { code: errorCode(error) })).finally(() => { pending = false; });
  };
  void tick(); timer = setInterval(() => { void tick(); }, 60_000);
});
client.on(Events.InteractionCreate, interaction => { void handler.handle(interaction); });
client.on(Events.Error, error => log('gateway_error', { code: errorCode(error) }));
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  if (timer) clearInterval(timer);
  await client.destroy(); await serial.run(() => store.close()); log('stopped');
}
process.on('SIGINT', () => { void shutdown(); }); process.on('SIGTERM', () => { void shutdown(); });
try { await client.login(token); }
catch (error) { log('login_failed', { code: errorCode(error) }); await shutdown(); process.exitCode = 1; }
