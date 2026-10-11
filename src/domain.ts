import { randomUUID } from 'node:crypto';

export const ATMOSPHERES = ['Friendly', 'Chill', 'Beginner friendly', 'Happy to teach', 'Competitive'] as const;
export const PLAYSTYLES = ['Building / FOBs', 'Infantry', 'Vehicles', 'Logistics', 'Mixed'] as const;
export const FACTIONS = ['Blue / Lonestar', 'Red / Valkyra', 'Green / Manticore', 'Undecided'] as const;
export const MICROPHONES = ['Required', 'Optional'] as const;
export const SESSION_MS = 2 * 60 * 60 * 1000;
export const DRAFT_MS = 15 * 60 * 1000;
export const REMINDER_MS = 15 * 60 * 1000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const noMentions = { parse: [] as never[], repliedUser: false };

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
