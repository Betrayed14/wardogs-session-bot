# WARDOGS session-board bot

A Discord bot for groups playing on official WARDOGS servers. Players post server IDs and describe their group with atmosphere and playstyle tags. The board uses player-entered information; it does not verify in-game membership, server availability, or faction capacity.

## Quick start

1. Create an application and bot at [Discord Developer Portal](https://discord.com/developers/applications). Leave all privileged Gateway intents disabled.
2. Install it in your test Discord server using the `bot` and `applications.commands` scopes. Grant **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in your board channel. No Administrator permission is needed.
3. Copy `.env.example` to `.env` and set your bot token, application ID, and test guild ID locally. Do not send the token in chat or commit `.env`.
4. Use **Node 24.21.0** (pinned in `.nvmrc`) or Docker. For local execution:

```powershell
npm ci
npm test
npm run register
npm start
```

5. An administrator runs `/board setup channel:#servers`. Members then click **Create session**, fill in the form, select their tags, and publish.

The command registrar replaces this application's guild commands with the three command definitions in this project. Use a dedicated application. The bot does not register commands on startup. Re-run registration after command definitions change.

For Docker, after configuring `.env`:

```powershell
docker compose build
docker compose run --rm bot node dist/src/register.js
docker compose up -d
docker compose logs -f bot
```

The build runs the automated tests. SQLite and backups live in the persistent `bot-data` volume. The container runs as the unprivileged `node` user. Run one replica only, and never run local and Docker instances against the same token simultaneously.

## What members see

- One message per playing group: title, creator, exact server ID, faction, squad, tags, language, mic preference, optional voice-channel reference, short note, and expiry time.
- **Show ID**, **Edit**, **Still playing**, and **End session** controls. IDs stay text, including leading zeros; hyphenated numerical IDs and community UUIDs are accepted. ID syntax is checked, not server existence.
- `/session create` starts the same flow as the board button. `/session manage` recovers the creator's card controls.
- `/sessions atmosphere? playstyle? language?` returns private filtered results, five per page. Filters are combined with AND; language matching ignores case and surrounding spaces.

Creation uses five text inputs, then a private preview with faction, atmosphere, playstyle, and microphone selectors. A **Voice channel** button opens a separate view to stay within Discord's five-row message limit. Saving an edit does not renew the card. **Cancel** discards the draft.

Atmosphere: Friendly, Chill, Beginner friendly, Happy to teach, Competitive (one or two).

Playstyle: Building / FOBs, Infantry, Vehicles, Logistics, Mixed (one to three).

Microphone: Required or Optional. Faction: Blue / Lonestar, Red / Valkyra, Green / Manticore, or Undecided.

These are intentions, not restrictions on equipment or roles. The bot has no direct game-launch button and cannot place text on a user's clipboard or move users into voice. The voice reference opens the Discord channel normally.

## Permissions and lifecycle

- Creators can edit, renew, and end their own entry. Members with **Manage Messages in the board channel** can end another entry but cannot edit or renew it. **Manage Guild** is required for setup.
- Each creator has at most one active/publishing entry per Discord server. Separate groups may use the same game server ID.
- Entries expire two hours after publishing or renewal. The worker checks every minute and processes up to five pending jobs per tick; deletion can take longer during outages or backlogs. Ended entries leave browsing results immediately even if message deletion is pending.
- One reminder DM is attempted 15 minutes before expiry per renewal. The DM has working session controls. Blocked DMs do not stop expiration. A crash between persisting the reminder attempt and sending can lose that reminder; it will not send duplicates.
- Drafts and private browse cursors expire after 15 minutes. Opening another create/edit draft invalidates earlier drafts for that creator. Stale edits cannot overwrite a renewal or another save.
- Deleted public cards are detected on interaction synchronization or hourly reconciliation. They are not automatically recreated.
- Voice choices must be ordinary voice channels visible to the bot and accessible to the creator and board audience. The audience check is intentionally conservative: restrictive non-everyone voice overrides are rejected, even if a particular membership combination might work. No member enumeration or privileged intent is used. Invalid voice references are cleared on later synchronization.
- Moving the board to another channel is blocked while entries are active. Re-running setup in the same channel reuses the introduction message.
- No mass pings, attendance counting, temporary voice channels, map tools, or WARDOGS credentials are used.

## Persistence, recovery, and backups

SQLite stores board configuration, sessions, drafts, browsing cursors, and pending synchronization jobs. The active-entry constraint is enforced in SQLite. The handler serializes state changes and synchronization, and database writes are transactional.

Before publishing, the bot scans its own messages since the session was created for a persistent session marker. If a send times out after Discord creates the message, a retry recovers that message rather than sending another. Discord nonce enforcement provides additional protection for immediate retries. Failure to read history prevents publication until access is restored.

Transient Discord failures retry with exponential delays capped at 15 minutes. The SDK handles HTTP rate limits. Interactions are acknowledged immediately before queued network work; opening a modal does not wait for network calls. Later public-message updates use the bot token, not expired interaction tokens. JSON logs contain event names, error codes, session IDs, and backlog counts, never bot tokens or user notes.

The worker creates one consistent SQLite backup per UTC day and keeps seven daily backups. It runs again on startup if the day's backup is missing. Manual backup:

```powershell
npm run backup
# Or inside the running Docker service:
docker compose exec bot node dist/src/backup.js
```

Closed session records are deleted after seven days once pending cleanup finishes. Daily backups may retain older closed records for their additional seven-day rotation. Manual backups require manual retention management. Keep an off-host copy of important backups.

To restore, stop the bot, save a backup of the current database, replace the database with the chosen SQLite backup, and remove only that database's old `-wal` and `-shm` sidecars before restarting. Never replace a live database. Restoring an old backup rolls back state: manually inspect the board for posts created after the backup, since those posts are not represented in the restored database.

## Validation and rollout

`npm test` runs strict TypeScript compilation, service/SQLite tests, worker failure simulations, Discord payload checks, and mocked interaction flows. No token is needed for these tests. Tests use simulated time to accelerate expiration without changing production's two-hour duration.

Before enabling the bot in your main server, complete [LIVE-TEST.md](LIVE-TEST.md). Test desktop and mobile creation, editing, filtering, permission failures, reminder buttons, process restart, and removal of stale cards. Watch `sync_failed`, `reminder_failed`, `backup_failed`, and `cleanup_backlog` events. Repeated permission errors require administrator action; the bot preserves pending work and retries.

The image and automated tests can be validated without a Discord account. Authenticated Discord behavior and mobile rendering require the live test server. No game API calls are made.

## Verified interfaces

- [Official Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding): slash commands, buttons, modals, ephemeral replies, three-second acknowledgment, 15-minute interaction tokens.
- [Official component reference](https://docs.discord.com/developers/components/reference): standard action rows, select menus, and modal text inputs.
- [Official message API](https://docs.discord.com/developers/resources/message): bot-authored message edits/deletes and enforced nonces.
- [Official permissions](https://docs.discord.com/developers/topics/permissions) and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
- discord.js is pinned to **14.27.0**, checked against the package registry; Node is pinned to **24.21.0**. The earlier plan's documentation-based runtime estimate is superseded by the registry and installed runtime checks.
- WARDOGS [official updates](https://steamcommunity.com/app/1867240/allnews/) mention server-admin RCON. The [community RCON client](https://github.com/Yuban32/wardogs-rcon-api) identifies its reference as unofficial. No publicly documented official API for official-server party/player state was verified. Future self-hosted integration must be validated against an actual game server separately.
