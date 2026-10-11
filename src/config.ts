import { resolve } from 'node:path';

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}. Configure it in .env or your hosting environment.`); return value;
}
export const databasePath = () => resolve(process.env.DATABASE_PATH || './data/wardogs.sqlite');
export const backupDirectory = () => resolve(process.env.BACKUP_DIRECTORY || './data/backups');
