# Discord pilot acceptance checklist

Run in a dedicated test Discord server with a dedicated bot application. Leave privileged intents off. This checklist is **pending until performed with authenticated Discord access**.

- [ ] Install with only the documented bot permissions; register the three guild commands.
- [ ] Administrator configures a normal text board; a non-administrator cannot configure it.
- [ ] Repeating setup reuses the introduction message.
- [ ] Create a numerical-ID card on desktop. Check leading zeros, optional squad/note, all tags, and faction.
- [ ] Create another member's group on the same game server; confirm it is allowed. A second group from the same creator is rejected.
- [ ] On mobile, select tags, choose/clear a permitted voice channel, publish, and retrieve selectable ID text.
- [ ] A hidden voice channel is rejected with a private explanation.
- [ ] Filter by atmosphere, playstyle, and language; verify combined filtering and pagination using six or more groups.
- [ ] Creator edits a card without changing its expiry. A member cannot edit/renew another card.
- [ ] Board moderator ends another member's group without needing bot Administrator permission.
- [ ] Restart the bot; existing public buttons and `/session manage` still work.
- [ ] Renew from a reminder DM. Edit/save from DM controls. Block DMs and confirm expiry still occurs.
- [ ] Verify real two-hour expiration once; accelerated timing is already covered by automated tests.
- [ ] Delete a card manually and confirm it is removed from active state during reconciliation or synchronization.
- [ ] Remove Send Messages or Read Message History temporarily; verify actionable private errors and retry logs, then restore permissions.
- [ ] Check startup/daily backup creation and a consistent backup opened separately with SQLite.
- [ ] Inspect logs to confirm no secrets or note contents are logged.

Do not consider the pilot live-validated until these steps pass. No WARDOGS API key or account linkage is needed.
