# WARDOGS Session & Community Bot

A robust, zero-privileged-intent Discord bot for players on official WARDOGS servers. Features playing-group recruitment (LFG session cards with one-click Server ID retrieval), community skirmish challenges, squad duels, match reporting with dispute resolution, and persistent squad leaderboards.

---

## ⚡ Quick Start

### 1. Bot Invite & Channel Permissions
The bot requires **zero privileged Gateway intents** and only standard channel permissions (permission integer `85056`):
- **View Channel** (`0x400`)
- **Send Messages** (`0x800`)
- **Embed Links** (`0x4000`)
- **Read Message History** (`0x10000`)

> 🔗 **[Invite the Bot via Discord OAuth2](https://discord.com/oauth2/authorize?client_id=1452332133560615016&permissions=85056&scope=bot%20applications.commands)**

### 2. Environment Configuration
Copy `.env.example` to `.env` and fill in your credentials locally:
```bash
DISCORD_TOKEN=your_bot_token_here
DISCORD_APPLICATION_ID=1452332133560615016
DISCORD_GUILD_ID=your_guild_id_here
DATABASE_PATH=./data/wardogs.sqlite
BACKUP_DIRECTORY=./data/backups
```
*(Never commit `.env` or paste your bot token into public channels.)*

### 3. Running with Docker Compose (Recommended)
```bash
# Build the container (runs automated test suite during build)
docker compose build

# Register slash commands in your server
docker compose run --rm bot node dist/src/register.js

# Launch the bot in background
docker compose up -d

# Check live logs
docker compose logs -f bot
```

### 4. Running Locally with Node 24
Requires **Node.js 24.21.0** (with built-in `node:sqlite`):
```bash
npm ci
npm test
npm run register
npm start
```

---

## 📋 Commands Reference

| Command | Subcommand / Options | Description | Permission |
| :--- | :--- | :--- | :--- |
| `/help` | `[topic: all\|sessions\|challenges\|admin]` | Interactive guide for bot features, card controls, and setup | Everyone |
| `/board` | `setup channel:<#channel>` | Sets the text channel where playing-group session cards are posted | `ManageGuild` (Admin) |
| `/session` | `create` | Opens modal and private preview to publish an active squad card | Everyone |
| `/session` | `manage` | Opens the private management controls for your active card | Everyone |
| `/sessions` | `[atmosphere] [playstyle] [language]` | Browse and filter active groups with 5-card pages | Everyone |
| `/challenge` | `issue [opponent:<@user>]` | Post an open community challenge or direct rival duel | Everyone |
| `/challenge` | `list` | View currently open and active skirmishes with card links | Everyone |
| `/challenge` | `leaderboard` | View server leaderboard rankings (+3 win, +1 draw) | Everyone |
| `/challenge` | `setup channel:<#channel>` | Designate a dedicated channel for challenge cards | `ManageGuild` (Admin) |

---

## 🎮 Command Examples & Workflows

### 1. Server Administration & Initial Setup
An administrator configures the designated channels:

```
# Set the main playing-group session channel
/board setup channel:#squad-sessions

# Optional: Set a dedicated channel for community scrims (defaults to session board if omitted)
/challenge setup channel:#challenges
```

---

### 2. Playing Groups (LFG)

#### Creating a Session
Players can click the **Create session** button in the board channel or type:
```
/session create
```
1. **Details Modal**: Enter Title (e.g. `Night Patrol`), Server ID (e.g. `001-002` or UUID), Squad name (`Bravo-1`), Language (`English`), and optional Note (`Mic optional, FOB building focus`).
2. **Interactive Preview**: Select your Faction (*Blue / Lonestar*, *Red / Valkyra*, *Green / Manticore*), Atmosphere (*Chill*, *Beginner friendly*), Playstyle (*Building / FOBs*, *Infantry*), Microphone preference, and optional Voice Channel.
3. **Publish**: The card appears in the configured channel.

#### Joining a Session
Community members viewing a session card click:
- **Show ID**: Reveals the server ID privately (`001-002`) in an ephemeral message with instructions on joining in-game.

#### Managing Your Card
Creators can click card controls or run:
```
/session manage
```
- **Still playing**: Renews the session for another 2 hours.
- **Edit**: Reopens text fields to modify squad, title, or notes without resetting the renewal timer.
- **End session**: Immediately concludes the session and deletes the public card.

#### Filtering Active Sessions
Looking for a specific squad atmosphere or playstyle?
```
/sessions atmosphere:Chill playstyle:Infantry language:English
```
Returns a paginated list of matching squads.

---

### 3. Community Challenges & Squad Duels

#### Supported In-Game Activities
Challenges can be issued for specific playstyle metrics and combat feats:
- 💣 **Grenade Kills**: Frag and explosive grenade eliminations
- 💥 **C4 Explosive Kills**: Plastic explosive detonations and breach kills
- 🚐 **Spawn Vehicles Destroyed**: Mobile spawn trucks, APCs, and spawn beacons neutralized
- 🚜 **Vehicles Destroyed**: Enemy ground vehicles, tanks, and technicals destroyed
- 🚁 **Helicopters Destroyed**: Transport and attack helicopters shot down
- 🎯 **Hotzone Kills**: Kills scored inside the central contested Control Zone
- ⚔️ **Infantry Frags** & 🔥 **Combat Killstreaks**: Frontline assault rifle frags and survival streaks
- 🩺 **Combat Revives** & ❤️‍🩹 **Hotzone Rescues**: Defibrillator revives under fire
- 🏗️ **FOBs Deployed**, 🧱 **Fortifications Built**, 🧨 **Enemy FOBs Demolished**: Builder & logistics combat
- 🔭 **Long-Range Sniper Kills** & 👁️ **Targets Spotted**: Recon and marksman intel
- 💰 **Match Cash Earned** & 🎖️ **Bounties Claimed**: Mercenary economy and high-roller earnings

#### Issuing a Challenge
- **Combat Activity Race** (First to 10 Grenade Kills):
  ```
  /challenge issue activity:"💣 Grenade Kills" target:10 opponent:@SquadLeader
  ```
- **Demolition Duel** (First to 5 C4 Kills):
  ```
  /challenge issue activity:"💥 C4 Explosive Kills" target:5
  ```
- **Anti-Vehicle Skirmish** (Destroy 2 Helicopters or 3 Spawn Vehicles):
  ```
  /challenge issue activity:"🚁 Helicopters Destroyed" target:2
  /challenge issue activity:"🚐 Spawn Vehicles Destroyed" target:3
  ```
- **High-Score Duel** (leave target empty for highest count in match):
  ```
  /challenge issue activity:"🚜 Vehicles Destroyed"
  ```

#### Accepting a Challenge
Any player (or the tagged rival) clicks **Accept Challenge** on the card. Status transitions from `⚔️ Open Challenge` to `🔥 In Progress`.

#### Reporting Results
When the match concludes, both participants click **Report Result** on the card and choose:
- `Challenger Won`
- `Opponent Won`
- `Draw / Tie`

- **Consensus**: If both players agree, the match concludes as `🏆 Completed`, displays the winner, and records points to the leaderboard.
- **Disputes**: If reports conflict, the challenge flags as `⚠️ Disputed` and alerts server moderators.

#### Moderator Dispute Settlement
Moderators (`ManageMessages`) can click **Resolve Dispute** on any disputed card to make the official ruling.

#### Viewing the Leaderboard
```
/challenge leaderboard
```
Displays ranked community records:
> **1. @AlphaLeader** — **9 pts**  
> Wins: 3 | Losses: 0 | Draws: 0  
>  
> **2. @RivalCommander** — **4 pts**  
> Wins: 1 | Losses: 1 | Draws: 1  

*(Scoring: 3 points per win, 1 point per draw, 0 points per loss).*

---

### 4. Interactive In-Game Help

Players or admins can run `/help` anytime to view built-in guides:
```
# General overview of all commands and features
/help

# Deep dive into LFG session cards and controls
/help topic:sessions

# Guide to challenges, reporting, and leaderboard scoring
/help topic:challenges

# Administration, permissions, and moderation workflows
/help topic:admin
```

---

## 🛡️ Moderation & Safety

- **Moderator Session Cleanup**: Members with **Manage Messages in the board channel** can click **End session** on any inappropriate card to delete it.
- **Moderator Dispute Ruling**: Members with **Manage Messages** can resolve conflicting match reports with one click.
- **Ephemeral Responses**: Actions like "Show Server ID", draft editors, and search results are private to the user to avoid channel clutter.
- **No Mass Pings**: All message payloads enforce suppressed user and role mentions (`allowedMentions: { parse: [] }`).
- **Input Sanitization**: Markdown formatting characters in user inputs are escaped to prevent broken embed layouts or mention exploits.

---

## 💾 Persistence & Backup Architecture

- **SQLite WAL Mode**: State is stored in an embedded SQLite database using WAL (Write-Ahead Logging) and `PRAGMA busy_timeout=5000` for concurrent, atomic transactions.
- **Automated Daily Backups**: The background worker creates an atomic SQLite backup every 24 hours and maintains a 7-day rolling retention.
- **Manual Backup**:
  ```bash
  npm run backup
  # Or within Docker:
  docker compose exec bot node dist/src/backup.js
  ```
- **Graceful Recovery**: Stored draft states, card message IDs, and active challenge statuses survive bot restarts.

---

## 🧪 Testing & Validation

The project includes an automated test suite verifying domain rules, SQLite transactional integrity, permission boundaries, and Discord interaction mock flows:

```bash
npm test
```
- **35 automated tests**, 100% pass rate.
- Strict TypeScript compilation (`noUncheckedIndexedAccess`, `noUnusedLocals`).
