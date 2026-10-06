import type {Stream} from '../providers/types';
import {mainStorage, providerKvStorage} from '../storage/StorageService';
import {getScopedKvKey} from '../sandbox/kvKeys';

/**
 * Download server rules.
 *
 * A rule is an ordered list of server names (primary first, then fallbacks)
 * that the app uses to start a download without showing the server sheet.
 * Rules are saved per provider, and can be overridden per series (keyed by
 * the provider and the series info URL).
 *
 * Server names change between files ("GDrive [2.1GB]", "GDrive [700MB]"),
 * so rules store a normalized key and match loosely.
 */

/** What to do when no server from the rule is available. */
export type NoMatchAction = 'auto' | 'ask' | 'skip';

/**
 * Preferred video quality for files that offer several. The best quality at or
 * below the preference is used, or the lowest above it when none is.
 */
export type QualityPreference = 'any' | '2160' | '1080' | '720' | '480';

export const QUALITY_PREFERENCES: readonly QualityPreference[] = [
  'any',
  '2160',
  '1080',
  '720',
  '480',
];

export type ServerRuleScope = 'series' | 'provider';

export interface ServerRuleEntry {
  /** Normalized name used for matching, e.g. "gdrive". */
  key: string;
  /** Name shown to the user, e.g. "GDrive". */
  label: string;
}

export interface ServerRule {
  order: ServerRuleEntry[];
  onNoMatch: NoMatchAction;
  /** Missing means any quality. */
  quality?: QualityPreference;
  updatedAt: number;
}

export interface SeriesServerRule extends ServerRule {
  providerValue: string;
  infoUrl: string;
  title?: string;
}

export interface ResolvedServerRule {
  rule: ServerRule;
  scope: ServerRuleScope;
}

export const PROVIDER_RULES_KEY = 'downloadServerRules.provider';
export const SERIES_RULES_KEY = 'downloadServerRules.series';
const KNOWN_SERVERS_KEY = 'downloadServerRules.known';
const LEGACY_MIGRATED_KEY = 'downloadServerRules.legacyMigrated';

const MAX_KNOWN_SERVERS = 30;

/** Provider setting keys this feature replaces. Hidden in provider settings. */
export const isLegacyQuickDownloadSettingKey = (key: string): boolean =>
  /(^|_)quickDownload$/.test(key) || /(^|_)preferredDownloadServer$/.test(key);

/**
 * Reduce a server name to a stable key: lowercase, without sizes, qualities,
 * bracketed notes and punctuation. "CF Storage [2.1 GB]" -> "cf storage".
 */
export const normalizeServerName = (name: string | undefined): string => {
  if (!name) {
    return '';
  }
  return name
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(kb|mb|gb|tb)\b/g, ' ')
    .replace(/\b(\d{3,4}p|4k|uhd|fhd|hd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Short display label for a server: its name without bracketed notes. */
export const getServerLabel = (name: string | undefined): string => {
  const label = (name || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label || name?.trim() || 'Unknown server';
};

export const toRuleEntry = (serverName: string | undefined): ServerRuleEntry => ({
  key: normalizeServerName(serverName),
  label: getServerLabel(serverName),
});

/** True when a server key matches a rule key exactly or as whole words. */
export const serverKeyMatches = (serverKey: string, ruleKey: string): boolean => {
  if (!serverKey || !ruleKey) {
    return false;
  }
  return serverKey === ruleKey || ` ${serverKey} `.includes(` ${ruleKey} `);
};

export const isTorrentStream = (stream: Stream): boolean =>
  stream.type === 'torrent' || stream.link?.startsWith('magnet:');

/** Height in pixels from labels like "1080", "720p", "4K" or "UHD". */
export const parseStreamQuality = (
  quality: string | undefined,
): number | undefined => {
  if (!quality) {
    return undefined;
  }
  const lower = quality.toLowerCase();
  if (lower.includes('4k') || lower.includes('uhd')) {
    return 2160;
  }
  const match = lower.match(/(\d{3,4})\s*p?/);
  return match ? Number(match[1]) : undefined;
};

/**
 * Keep the streams that fit the quality preference. Streams without a known
 * quality always stay, since the provider did not say what they are.
 */
export const applyQualityPreference = (
  servers: Stream[],
  preference: QualityPreference | undefined,
): Stream[] => {
  if (!preference || preference === 'any') {
    return servers;
  }
  const heights = servers
    .map(server => parseStreamQuality(server.quality))
    .filter((height): height is number => height !== undefined);
  if (heights.length === 0) {
    return servers;
  }
  const wanted = Number(preference);
  const atOrBelow = heights.filter(height => height <= wanted);
  const target =
    atOrBelow.length > 0 ? Math.max(...atOrBelow) : Math.min(...heights);
  return servers.filter(server => {
    const height = parseStreamQuality(server.quality);
    return height === undefined || height === target;
  });
};

/**
 * Split servers into the ones the rule asks for (in rule order, each server
 * once) and the rest (in provider order).
 */
export const orderServersByRule = (
  servers: Stream[],
  rule: Pick<ServerRule, 'order'>,
): {matched: Stream[]; rest: Stream[]} => {
  const used = new Set<number>();
  const matched: Stream[] = [];
  const keys = servers.map(server => normalizeServerName(server.server));

  for (const entry of rule.order) {
    // Exact matches first, then looser whole-word matches.
    const exact = keys
      .map((key, index) => (key === entry.key ? index : -1))
      .filter(index => index >= 0);
    const loose = keys
      .map((key, index) =>
        key !== entry.key && serverKeyMatches(key, entry.key) ? index : -1,
      )
      .filter(index => index >= 0);
    for (const index of [...exact, ...loose]) {
      if (!used.has(index)) {
        used.add(index);
        matched.push(servers[index]);
      }
    }
  }

  const rest = servers.filter((_, index) => !used.has(index));
  return {matched, rest};
};

/**
 * Build a rule from a server the user picked: that server first, then the
 * other servers in the order they were listed, as fallbacks.
 */
export const buildRuleFromSelection = (
  selected: Stream,
  servers: Stream[],
  onNoMatch: NoMatchAction = 'auto',
  quality?: QualityPreference,
): ServerRule => {
  const order: ServerRuleEntry[] = [];
  const seen = new Set<string>();
  for (const server of [selected, ...servers]) {
    // Torrents only become fallbacks when the user picked one themselves.
    if (server !== selected && isTorrentStream(server)) {
      continue;
    }
    const entry = toRuleEntry(server.server);
    if (!entry.key || seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    order.push(entry);
  }
  return {
    order,
    onNoMatch,
    ...(quality && quality !== 'any' ? {quality} : {}),
    updatedAt: Date.now(),
  };
};

export const describeRule = (
  rule: Pick<ServerRule, 'order'> & Partial<Pick<ServerRule, 'quality'>>,
): string => {
  const servers =
    rule.order.length > 0
      ? rule.order.map(entry => entry.label).join(' → ')
      : 'Best available';
  return rule.quality && rule.quality !== 'any'
    ? `${servers} · ${rule.quality}p`
    : servers;
};

const seriesRuleKey = (providerValue: string, infoUrl: string) =>
  `${providerValue}::${infoUrl}`;

const readMap = <T>(key: string): Record<string, T> =>
  mainStorage.getObject<Record<string, T>>(key) || {};

const writeMap = <T>(key: string, value: Record<string, T>) => {
  mainStorage.setObject(key, value);
};

const readLegacyKvString = (
  providerValue: string,
  key: string,
): string | undefined => {
  const raw = providerKvStorage.getString(getScopedKvKey(providerValue, key));
  if (raw === undefined || raw === null) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return raw;
  }
};

/**
 * Carry over the provider's own "Preferred Download Server" setting the first
 * time a provider is used with this feature.
 */
const migrateLegacyProviderSetting = (providerValue: string): void => {
  const migrated = readMap<boolean>(LEGACY_MIGRATED_KEY);
  if (migrated[providerValue]) {
    return;
  }
  migrated[providerValue] = true;
  writeMap(LEGACY_MIGRATED_KEY, migrated);

  const preferred = (
    readLegacyKvString(providerValue, `${providerValue}_preferredDownloadServer`) ||
    readLegacyKvString(providerValue, 'preferredDownloadServer') ||
    ''
  ).trim();
  if (!preferred || preferred.toLowerCase() === 'auto') {
    return;
  }
  const rules = readMap<ServerRule>(PROVIDER_RULES_KEY);
  if (rules[providerValue]) {
    return;
  }
  const entry = toRuleEntry(preferred);
  if (!entry.key) {
    return;
  }
  rules[providerValue] = {
    order: [entry],
    onNoMatch: 'auto',
    updatedAt: Date.now(),
  };
  writeMap(PROVIDER_RULES_KEY, rules);
};

export const serverRulesStorage = {
  getProviderRule(providerValue: string): ServerRule | undefined {
    migrateLegacyProviderSetting(providerValue);
    return readMap<ServerRule>(PROVIDER_RULES_KEY)[providerValue];
  },

  setProviderRule(providerValue: string, rule: ServerRule): void {
    const rules = readMap<ServerRule>(PROVIDER_RULES_KEY);
    rules[providerValue] = {...rule, updatedAt: Date.now()};
    writeMap(PROVIDER_RULES_KEY, rules);
  },

  clearProviderRule(providerValue: string): void {
    const rules = readMap<ServerRule>(PROVIDER_RULES_KEY);
    delete rules[providerValue];
    writeMap(PROVIDER_RULES_KEY, rules);
  },

  getSeriesRule(
    providerValue: string,
    infoUrl: string | undefined,
  ): SeriesServerRule | undefined {
    if (!infoUrl) {
      return undefined;
    }
    return readMap<SeriesServerRule>(SERIES_RULES_KEY)[
      seriesRuleKey(providerValue, infoUrl)
    ];
  },

  setSeriesRule(
    providerValue: string,
    infoUrl: string,
    rule: ServerRule,
    title?: string,
  ): void {
    const rules = readMap<SeriesServerRule>(SERIES_RULES_KEY);
    rules[seriesRuleKey(providerValue, infoUrl)] = {
      ...rule,
      providerValue,
      infoUrl,
      title,
      updatedAt: Date.now(),
    };
    writeMap(SERIES_RULES_KEY, rules);
  },

  clearSeriesRule(providerValue: string, infoUrl: string): void {
    const rules = readMap<SeriesServerRule>(SERIES_RULES_KEY);
    delete rules[seriesRuleKey(providerValue, infoUrl)];
    writeMap(SERIES_RULES_KEY, rules);
  },

  listSeriesRules(providerValue: string): SeriesServerRule[] {
    return Object.values(readMap<SeriesServerRule>(SERIES_RULES_KEY))
      .filter(rule => rule.providerValue === providerValue)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  clearAllForProvider(providerValue: string): void {
    this.clearProviderRule(providerValue);
    const rules = readMap<SeriesServerRule>(SERIES_RULES_KEY);
    for (const [key, rule] of Object.entries(rules)) {
      if (rule.providerValue === providerValue) {
        delete rules[key];
      }
    }
    writeMap(SERIES_RULES_KEY, rules);
  },

  /** The series rule if there is one, otherwise the provider rule. */
  resolve(
    providerValue: string,
    infoUrl: string | undefined,
  ): ResolvedServerRule | null {
    const seriesRule = this.getSeriesRule(providerValue, infoUrl);
    if (seriesRule) {
      return {rule: seriesRule, scope: 'series'};
    }
    const providerRule = this.getProviderRule(providerValue);
    if (providerRule) {
      return {rule: providerRule, scope: 'provider'};
    }
    return null;
  },

  /** Remember server names a provider has returned, newest first. */
  recordKnownServers(providerValue: string, servers: Stream[]): void {
    if (servers.length === 0) {
      return;
    }
    const known = readMap<ServerRuleEntry[]>(KNOWN_SERVERS_KEY);
    const merged: ServerRuleEntry[] = [];
    const seen = new Set<string>();
    for (const entry of [
      ...servers.filter(server => !isTorrentStream(server)).map(server => toRuleEntry(server.server)),
      ...(known[providerValue] || []),
    ]) {
      if (!entry.key || seen.has(entry.key)) {
        continue;
      }
      seen.add(entry.key);
      merged.push(entry);
    }
    known[providerValue] = merged.slice(0, MAX_KNOWN_SERVERS);
    writeMap(KNOWN_SERVERS_KEY, known);
  },

  getKnownServers(providerValue: string): ServerRuleEntry[] {
    return readMap<ServerRuleEntry[]>(KNOWN_SERVERS_KEY)[providerValue] || [];
  },
};
