import {mainStorage} from '../storage/StorageService';
import {normalizeServerName, type ServerRuleEntry} from './serverRules';

/**
 * How well each server has worked for a provider: how often downloads from it
 * finished or failed, and how fast they were. Used to suggest an order and to
 * rank the "best available" fallback.
 */

export interface ServerHealthEntry {
  ok: number;
  fail: number;
  /** Smoothed average speed of finished downloads, bytes per second. */
  speed: number;
  updatedAt: number;
}

const STORAGE_KEY = 'downloadServerHealth';
/** Counts are halved past this, so old results fade. */
const MAX_SAMPLES = 40;
const SPEED_SMOOTHING = 0.3;

type HealthMap = Record<string, ServerHealthEntry>;

const entryKey = (provider: string, serverName: string | undefined) =>
  `${provider}::${normalizeServerName(serverName)}`;

const readAll = (): HealthMap =>
  mainStorage.getObject<HealthMap>(STORAGE_KEY) || {};

export const getServerHealth = (
  provider: string,
  serverName: string | undefined,
): ServerHealthEntry | undefined => readAll()[entryKey(provider, serverName)];

export const recordServerOutcome = (
  provider: string | undefined,
  serverName: string | undefined,
  outcome: {success: boolean; speed?: number},
): void => {
  if (!provider || !normalizeServerName(serverName)) {
    return;
  }
  const all = readAll();
  const key = entryKey(provider, serverName);
  const current = all[key] || {ok: 0, fail: 0, speed: 0, updatedAt: 0};
  const next: ServerHealthEntry = {
    ...current,
    ok: current.ok + (outcome.success ? 1 : 0),
    fail: current.fail + (outcome.success ? 0 : 1),
    updatedAt: Date.now(),
  };
  if (outcome.success && outcome.speed && outcome.speed > 0) {
    next.speed =
      current.speed > 0
        ? current.speed * (1 - SPEED_SMOOTHING) + outcome.speed * SPEED_SMOOTHING
        : outcome.speed;
  }
  if (next.ok + next.fail > MAX_SAMPLES) {
    next.ok = Math.round(next.ok / 2);
    next.fail = Math.round(next.fail / 2);
  }
  all[key] = next;
  mainStorage.setObject(STORAGE_KEY, all);
};

/**
 * Higher is better. Reliability counts most; speed breaks ties. A server with
 * no history scores as an average one, so new servers still get tried.
 */
export const scoreServerHealth = (
  entry: ServerHealthEntry | undefined,
): number => {
  const ok = entry?.ok ?? 0;
  const fail = entry?.fail ?? 0;
  const reliability = (ok + 1) / (ok + fail + 2);
  const speedMbps = (entry?.speed ?? 0) / (1024 * 1024);
  return reliability * (1 + Math.log10(1 + speedMbps));
};

export const describeServerHealth = (
  entry: ServerHealthEntry | undefined,
): string | undefined => {
  if (!entry || entry.ok + entry.fail === 0) {
    return undefined;
  }
  const percent = Math.round((entry.ok / (entry.ok + entry.fail)) * 100);
  const speed =
    entry.speed > 0
      ? ` · ${(entry.speed / (1024 * 1024)).toFixed(1)} MB/s`
      : '';
  return `${percent}% worked${speed}`;
};

/** Sort servers by health, best first. Servers with equal scores keep order. */
export const sortByHealth = <T>(
  provider: string | undefined,
  items: T[],
  getName: (item: T) => string | undefined,
): T[] => {
  if (!provider) {
    return items;
  }
  const all = readAll();
  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreServerHealth(all[entryKey(provider, getName(item))]),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.item);
};

export const sortRuleEntriesByHealth = (
  provider: string | undefined,
  entries: ServerRuleEntry[],
): ServerRuleEntry[] => sortByHealth(provider, entries, entry => entry.label);

export const clearServerHealth = (provider: string): void => {
  const all = readAll();
  const prefix = `${provider}::`;
  for (const key of Object.keys(all)) {
    if (key.startsWith(prefix)) {
      delete all[key];
    }
  }
  mainStorage.setObject(STORAGE_KEY, all);
};
