import { randomUUID } from 'node:crypto';

export const ATMOSPHERES = ['Friendly', 'Chill', 'Beginner friendly', 'Happy to teach', 'Competitive'] as const;
export const PLAYSTYLES = ['Building / FOBs', 'Infantry', 'Vehicles', 'Logistics', 'Mixed'] as const;
export const FACTIONS = ['Blue / Lonestar', 'Red / Valkyra', 'Green / Manticore', 'Undecided'] as const;
export const MICROPHONES = ['Required', 'Optional'] as const;
export const SESSION_MS = 2 * 60 * 60 * 1000;
export const DRAFT_MS = 15 * 60 * 1000;
export const REMINDER_MS = 15 * 60 * 1000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CHALLENGE_TYPES = ['Infantry Skirmish', 'FOB Race', 'Vehicle Duel', 'Dogfight', 'Mixed Warfare'] as const;
export const CHALLENGE_MS = 24 * 60 * 60 * 1000;
export const noMentions = { parse: [] as never[], repliedUser: false };

export interface ActivitySpec {
  id: string;
  name: string;
  category: string;
  unit: string;
  emoji: string;
}

export const CHALLENGE_ACTIVITIES: ActivitySpec[] = [
  // Assault & Demolitions
  { id: 'grenade_kills', name: 'Grenade Kills', category: 'Assault', unit: 'kills', emoji: '💣' },
  { id: 'c4_kills', name: 'C4 Explosive Kills', category: 'Assault', unit: 'kills', emoji: '💥' },
  { id: 'hotzone_kills', name: 'Hotzone Kills', category: 'Assault', unit: 'kills', emoji: '🎯' },
  { id: 'infantry_frags', name: 'Infantry Frags', category: 'Assault', unit: 'kills', emoji: '⚔️' },
  { id: 'killstreak', name: 'Combat Killstreak', category: 'Assault', unit: 'streak', emoji: '🔥' },

  // Vehicles & Anti-Armor
  { id: 'spawn_vehicles_destroyed', name: 'Spawn Vehicles Destroyed', category: 'Vehicles', unit: 'spawn vehicles', emoji: '🚐' },
  { id: 'vehicles_destroyed', name: 'Vehicles Destroyed', category: 'Vehicles', unit: 'vehicles', emoji: '🚜' },
  { id: 'helis_destroyed', name: 'Helicopters Destroyed', category: 'Vehicles', unit: 'helis', emoji: '🚁' },
  { id: 'troop_drops', name: 'Hotzone Troop Drops', category: 'Vehicles', unit: 'drops', emoji: '🪂' },

  // Support & Builder
  { id: 'fobs_built', name: 'FOBs Deployed', category: 'Support', unit: 'FOBs', emoji: '🏗️' },
  { id: 'fortifications_built', name: 'Fortifications Built', category: 'Support', unit: 'structures', emoji: '🧱' },
  { id: 'supplies_delivered', name: 'Supplies Delivered', category: 'Support', unit: 'crates', emoji: '📦' },
  { id: 'fobs_demolished', name: 'Enemy FOBs Demolished', category: 'Support', unit: 'FOBs', emoji: '🧨' },

  // Medic
  { id: 'revives', name: 'Combat Revives', category: 'Medic', unit: 'revives', emoji: '🩺' },
  { id: 'hotzone_revives', name: 'Hotzone Rescues', category: 'Medic', unit: 'revives', emoji: '❤️‍🩹' },

  // Recon
  { id: 'sniper_kills', name: 'Long-Range Sniper Kills', category: 'Recon', unit: 'kills', emoji: '🔭' },
  { id: 'targets_spotted', name: 'Targets Spotted', category: 'Recon', unit: 'spots', emoji: '👁️' },

  // Economy
  { id: 'cash_earned', name: 'Match Cash Earned', category: 'Economy', unit: '$ cash', emoji: '💰' },
  { id: 'bounties_claimed', name: 'Bounties Claimed', category: 'Economy', unit: 'bounties', emoji: '🎖️' },

  // Skirmish Formats
  { id: 'infantry_skirmish', name: 'Infantry Skirmish', category: 'General', unit: 'rounds', emoji: '⚔️' },
  { id: 'fob_race', name: 'FOB Race', category: 'General', unit: 'FOBs', emoji: '🏗️' },
  { id: 'vehicle_duel', name: 'Vehicle Duel', category: 'General', unit: 'vehicles', emoji: '🚜' },
  { id: 'dogfight', name: 'Dogfight', category: 'General', unit: 'helis', emoji: '🚁' },
  { id: 'mixed_warfare', name: 'Mixed Warfare', category: 'General', unit: 'points', emoji: '🛡️' },
];

export function findActivity(nameOrId: string): ActivitySpec {
  const norm = nameOrId.toLowerCase().trim();
  const match = CHALLENGE_ACTIVITIES.find(a => a.id === norm || a.name.toLowerCase() === norm);
  if (match) return match;
  return { id: 'custom', name: nameOrId, category: 'Custom', unit: 'points', emoji: '⚔️' };
}

export type ChallengeState = 'open' | 'accepted' | 'completed' | 'disputed' | 'withdrawn' | 'expired';
export type ReportOutcome = 'issuer_win' | 'opponent_win' | 'draw';
export interface ChallengeDetails {
  title: string; type: string; targetValue?: number | null; serverId: string; rules: string; targetOpponentId: string | null;
}
export interface Challenge {
  id: string; guildId: string; issuerId: string; opponentId: string | null;
  details: ChallengeDetails; state: ChallengeState; createdAt: number;
  acceptedAt: number | null; expiresAt: number; closedAt: number | null;
  reports: Record<string, ReportOutcome>; winnerId: string | null;
  messageId: string | null; channelId: string | null;
}
export interface SquadStats {
  guildId: string; squadName: string; wins: number; losses: number; draws: number; points: number;
}

export class UserError extends Error {}
export interface Details {
  title: string; serverId: string; squad: string; language: string; note: string;
  faction: string; atmosphere: string[]; playstyle: string[]; microphone: string;
  voiceChannelId: string | null;
}
export type SessionState = 'publishing' | 'active' | 'ended' | 'expired' | 'removed';
export interface Session {
  id: string; guildId: string; ownerId: string; channelId: string; messageId: string | null;
  state: SessionState; details: Details; createdAt: number; confirmedAt: number;
  expiresAt: number; closedAt: number | null; reminderAt: number | null; revision: number; nonce: string;
}
export interface Draft {
  id: string; guildId: string; ownerId: string; sessionId: string | null; baseRevision: number | null;
  details: Details; createdAt: number; expiresAt: number;
}
export interface Browse {
  id: string; guildId: string; ownerId: string; atmosphere?: string; playstyle?: string;
  language?: string; expiresAt: number;
}
export interface Board { guildId: string; channelId: string; messageId: string | null }
export interface Job { key: string; sessionId: string; kind: 'sync' | 'remind'; attempts: number; nextAt: number }
export const id = () => randomUUID();
export function initialDetails(): Details {
  return { title: '', serverId: '', squad: '', language: 'English', note: '', faction: '', atmosphere: [], playstyle: [], microphone: 'Optional', voiceChannelId: null };
}
function bounded(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new UserError(`${label} must be text.`);
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(text))
    throw new UserError(`${label} must be ${required ? '1' : '0'}–${max} characters without control characters.`);
  return text;
}
export function validateText(details: Details): Details {
  const serverId = bounded(details.serverId, 'Server ID', 64, true);
  if (!/^(?:\d+(?:-\d+)*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(serverId))
    throw new UserError('Enter a numerical server ID (hyphen-separated digits are accepted), or a community-server UUID.');
  return { ...details, serverId, title: bounded(details.title, 'Title', 80, true),
    squad: bounded(details.squad, 'Squad', 60), language: bounded(details.language, 'Language', 40, true),
    note: bounded(details.note, 'Note', 300) };
}
export function validateChoice(value: string, choices: readonly string[], label: string) {
  if (!choices.includes(value)) throw new UserError(`Choose a valid ${label}.`);
}
export function validateTags(tags: string[], choices: readonly string[], max: number, label: string) {
  if (tags.length < 1 || tags.length > max || new Set(tags).size !== tags.length || tags.some(t => !choices.includes(t)))
    throw new UserError(`Choose 1–${max} ${label} tags.`);
}
export function validateDetails(details: Details): Details {
  const result = validateText(details);
  validateChoice(result.faction, FACTIONS, 'faction');
  validateChoice(result.microphone, MICROPHONES, 'microphone preference');
  validateTags(result.atmosphere, ATMOSPHERES, 2, 'atmosphere');
  validateTags(result.playstyle, PLAYSTYLES, 3, 'playstyle');
  return result;
}
export function initialChallengeDetails(): ChallengeDetails {
  return { title: '', type: 'Infantry Skirmish', serverId: '', rules: '', targetOpponentId: null };
}
export function validateChallengeDetails(details: ChallengeDetails): ChallengeDetails {
  const title = bounded(details.title, 'Challenge title', 80, true);
  const serverId = bounded(details.serverId, 'Server ID', 64, true);
  if (!/^(?:\d+(?:-\d+)*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(serverId))
    throw new UserError('Enter a numerical server ID (hyphen-separated digits are accepted), or a community-server UUID.');
  const norm = details.type.toLowerCase().trim();
  const valid = CHALLENGE_ACTIVITIES.some(a => a.id === norm || a.name.toLowerCase() === norm);
  if (!valid) throw new UserError('Unknown challenge activity or skirmish type.');
  const rules = bounded(details.rules, 'Rules', 300, false);
  let targetValue = details.targetValue ?? null;
  if (targetValue !== null && targetValue !== undefined) {
    targetValue = Number(targetValue);
    if (!Number.isFinite(targetValue) || targetValue <= 0 || targetValue > 100000)
      throw new UserError('Target goal must be a positive number up to 100,000.');
  }
  return { ...details, title, serverId, rules, targetValue };
}
export function authorize(session: Session, guildId: string, userId: string, moderator = false, action = 'manage') {
  if (session.guildId !== guildId || (session.ownerId !== userId && !(moderator && action === 'end')))
    throw new UserError('Only the creator can edit or renew this session. Moderators can end it.');
}
export function escapeText(value: string): string {
  return value.replace(/@/g, '@\u200b').replace(/([\\`*_{}\[\]()<>~|])/g, '\\$1');
}
export function matches(session: Session, filter: Pick<Browse, 'atmosphere' | 'playstyle' | 'language'>, now: number) {
  return session.state === 'active' && session.expiresAt > now &&
    (!filter.atmosphere || session.details.atmosphere.includes(filter.atmosphere)) &&
    (!filter.playstyle || session.details.playstyle.includes(filter.playstyle)) &&
    (!filter.language || session.details.language.toLocaleLowerCase('en').trim() === filter.language.toLocaleLowerCase('en').trim());
}
export function paginate<T>(items: T[], requestedPage: number, size = 5) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(0, Math.floor(requestedPage) || 0), pages - 1);
  return { items: items.slice(page * size, (page + 1) * size), page, pages, total: items.length };
}
