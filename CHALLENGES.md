# WARDOGS Community Challenges & Activity Duels

This document details the community challenge system, playstyle activities, duel rules, scoring mechanics, and moderation workflows implemented in the WARDOGS Discord bot.

---

## 🎯 Overview

The challenge system lets community members, squads, and rivals compete in verified, activity-specific duels and open skirmishes on official WARDOGS servers. 

Challenges can be issued as **Races to a Target Goal** (e.g., *First to 10 Grenade Kills*) or **High-Score Duels** (e.g., *Most Vehicles Destroyed in a match*). Results are recorded upon mutual player consensus, disputed matches can be settled by moderators, and all outcomes feed into the persistent server leaderboard.

---

## 💥 Supported In-Game Activities

Activities are mapped to the core combat and progression tracks in WARDOGS:

### 1. Assault & Demolitions
- **💣 Grenade Kills**: Eliminations using frag, offensive, or tactical grenades.
- **💥 C4 Explosive Kills**: Plastic explosive detonations, breach kills, and vehicle ambush detonations.
- **🎯 Hotzone Kills**: Kills scored strictly inside the contested central Control Zone.
- **⚔️ Infantry Frags**: Frontline assault rifle, SMG, and sidearm kills.
- **🔥 Combat Killstreak**: Highest uninterrupted kills in a single life without dying.

### 2. Vehicles & Anti-Armor (Driver / Pilot)
- **🚐 Spawn Vehicles Destroyed**: Mobile spawn trucks, APC spawn beacons, and deployment transports destroyed.
- **🚜 Vehicles Destroyed**: Total enemy ground armor, tanks, technicals, and transport vehicles eliminated.
- **🚁 Helicopters Destroyed**: Enemy transport and attack helicopters shot down with rockets, anti-air, or cannon fire.
- **🪂 Hotzone Troop Drops**: Successful troop transport landings deploying squadmates directly into active hotzones.

### 3. Support & Builder (FOB Construction & Logistics)
- **🏗️ FOBs Deployed**: Operational Forward Operating Bases constructed using the builder tool and FOB kit.
- **🧱 Fortifications Built**: Defensive structures placed (sandbag walls, razor wire, roadblocks).
- **🧨 Enemy FOBs Demolished**: Enemy base radios or structures demolished using heavy explosives or rocket fire.
- **📦 Supplies Delivered**: Logistics runs delivering ammo crates and construction supplies to forward squads.

### 4. Medic (Squad Sustain & Combat Rescue)
- **🩺 Combat Revives**: Defibrillator revives bringing fallen teammates back into the fight.
- **❤️‍🩹 Hotzone Rescues**: High-risk revives performed under fire directly inside contested hotzones.

### 5. Recon (Marksman & Surveillance)
- **🔭 Long-Range Sniper Kills**: High-precision marksman or sniper eliminations at long distance (150m+).
- **👁️ Targets Spotted**: Enemy infantry, armor, or FOB installations spotted and marked for team intel.

### 6. Mercenary Economy (High Roller & Bounties)
- **💰 Match Cash Earned**: Net in-game cash earned after kit expenses during a match.
- **🎖️ Bounties Claimed**: Eliminating high-value opposing players carrying bounties.

---

## ⚔️ Issuing a Challenge

### Command Syntax
```
/challenge issue [activity] [target] [opponent]
```

- **`activity`** *(optional)*: Pre-select any of the 19 supported combat activities.
- **`target`** *(optional)*: Specify a numerical target (e.g., `5` or `10`).
  - When set: The challenge becomes a **Race to Target** (*First to 10 kills*).
  - When omitted: The challenge is a **High-Score Duel** (*Highest count in match*).
- **`opponent`** *(optional)*: Tag a rival player (`@User`) for a direct duel. If left blank, it is posted as an **Open Challenge** for any community member to accept.

### Interactive Modal
Running `/challenge issue` opens a modal allowing you to define:
1. **Title**: Name of your challenge (e.g. `5 C4 Kills Duel` or `Sector Alpha Skirmish`).
2. **Server ID**: Numerical WARDOGS server ID (e.g. `001-002`) or community UUID.
3. **Activity**: Pre-filled with your chosen activity or custom text.
4. **Target Goal**: Pre-filled with your chosen target number (or leave blank).
5. **Rules / Conditions**: Custom restrictions (e.g. `Frag grenades only, Sector Alpha only`).

---

## 📋 Copy-Paste Command Examples

### 1. Demolition & Combat Races
```
# First player to reach 10 Grenade Kills against a specific rival
/challenge issue activity:"💣 Grenade Kills" target:10 opponent:@SquadLeader

# First player to score 5 C4 kills in an open challenge
/challenge issue activity:"💥 C4 Explosive Kills" target:5

# Hotzone King: First squad to reach 25 Hotzone Kills
/challenge issue activity:"🎯 Hotzone Kills" target:25
```

### 2. Anti-Vehicle & Air Superiority Duels
```
# Anti-Air Duel: First to shoot down 2 enemy helicopters
/challenge issue activity:"🚁 Helicopters Destroyed" target:2

# Spawn Denier: First to destroy 3 enemy mobile spawn vehicles
/challenge issue activity:"🚐 Spawn Vehicles Destroyed" target:3

# Armor Duel: Most enemy vehicles destroyed across a match (High Score)
/challenge issue activity:"🚜 Vehicles Destroyed"
```

### 3. Builder, Support & Medic Challenges
```
# Master Builder: First to erect 4 forward bases
/challenge issue activity:"🏗️ FOBs Deployed" target:4

# Combat Lifesaver: First to pull off 15 Defib Revives
/challenge issue activity:"🩺 Combat Revives" target:15
```

---

## 🔄 Match Lifecycle & Dual Reporting

```
[Open Challenge] ──(Opponent clicks Accept)──► [In Progress]
                                                     │
                                       (Both click Report Result)
                                                     │
                             ┌───────────────────────┴───────────────────────┐
                             ▼                                               ▼
                      Reports Match                                  Conflicting Reports
                             │                                               │
                             ▼                                               ▼
                       [🏆 Completed]                                   [⚠️ Disputed]
                  (Points awarded to winner)                                 │
                                                                   (Moderator reviews & rules)
                                                                             │
                                                                             ▼
                                                                       [🏆 Completed]
```

1. **Accepting**: Any player (or the tagged rival) clicks **Accept Challenge** on the public challenge card.
2. **Connecting**: Players click **Show Server ID** on the card to retrieve the exact server ID privately.
3. **Reporting Results**:
   When the match concludes, both participants click **Report Result** on the card and choose:
   - `Challenger Won`
   - `Opponent Won`
   - `Draw / Tie`
4. **Consensus**:
   - If both players report the same outcome, the challenge card transitions to `🏆 Completed`, displays the winner, and records stats.
5. **Dispute Resolution**:
   - If reports conflict, the challenge card flags as `⚠️ Disputed` and unlocks a **Resolve Dispute** button exclusively accessible to server moderators (`ManageMessages`).
   - A moderator makes the official ruling, concluding the match and awarding leaderboard points.

---

## 🏆 Scoring & Leaderboards

- **Win**: **+3 points**
- **Draw**: **+1 point**
- **Loss**: **0 points**

View rankings at any time using:
```
/challenge leaderboard
```
Ranks players and squads by total points, wins, and draws.
