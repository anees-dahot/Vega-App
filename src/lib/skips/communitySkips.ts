import {mainStorage} from '../storage/StorageService';
import type {SkipInterval} from '../providers/types';

/**
 * Intro, outro and recap times for anime from AniSkip, a community database.
 * The show is found on MyAnimeList (through Jikan) by its title, then the
 * times for the episode are looked up by that id. Only a title that matches
 * exactly is used, so a show that is not anime simply has no times.
 */

const JIKAN_URL = 'https://api.jikan.moe/v4/anime';
const ANISKIP_URL = 'https://api.aniskip.com/v2/skip-times';
const CACHE_KEY = 'communitySkipCache';
export const COMMUNITY_SKIP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A title that matched nothing is looked for again after this. */
export const COMMUNITY_SKIP_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  fetchedAt: number;
}

/** Lowercase letters and digits of any alphabet, so Japanese titles compare too. */
const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const readCache = (): Record<string, CacheEntry> =>
  mainStorage.getObject<Record<string, CacheEntry>>(CACHE_KEY) || {};

const writeCache = (cache: Record<string, CacheEntry>) => {
  // Keep the cache small: drop the oldest entries past a limit.
  const keys = Object.keys(cache);
  if (keys.length > 300) {
    keys
      .sort((a, b) => cache[a].fetchedAt - cache[b].fetchedAt)
      .slice(0, keys.length - 300)
      .forEach(key => delete cache[key]);
  }
  mainStorage.setObject(CACHE_KEY, cache);
};

type FetchJson = (url: string) => Promise<any>;

const defaultFetchJson: FetchJson = async url => {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
};

/** The MyAnimeList id whose title is exactly the one given, if any. */
export const pickMalId = (results: any[], title: string): number | undefined => {
  const wanted = normalizeName(title);
  if (!wanted) {
    return undefined;
  }
  const match = (results || []).find(result => {
    const names: string[] = [
      result?.title,
      result?.title_english,
      result?.title_japanese,
      ...(Array.isArray(result?.titles) ? result.titles.map((entry: any) => entry?.title) : []),
    ].filter(Boolean);
    return names.some(name => normalizeName(name) === wanted);
  });
  return typeof match?.mal_id === 'number' ? match.mal_id : undefined;
};

const SKIP_TITLES: Record<string, string> = {
  op: 'Intro',
  ed: 'Outro',
  recap: 'Recap',
  'mixed-op': 'Intro',
  'mixed-ed': 'Outro',
};

/** AniSkip's answer as the skip intervals the player uses. */
export const toSkipIntervals = (data: any): SkipInterval[] => {
  if (!data?.found || !Array.isArray(data.results)) {
    return [];
  }
  return data.results
    .map((result: any) => ({
      title: SKIP_TITLES[result?.skipType] || 'Skip',
      from: Number(result?.interval?.startTime),
      to: Number(result?.interval?.endTime),
    }))
    .filter((skip: SkipInterval) => Number.isFinite(skip.from) && Number.isFinite(skip.to) && skip.to > skip.from)
    .sort((a: SkipInterval, b: SkipInterval) => a.from - b.from);
};

export const getCommunitySkips = async (
  query: {title: string; episode: number},
  options: {now?: number; fetchJson?: FetchJson} = {},
): Promise<SkipInterval[]> => {
  const now = options.now ?? Date.now();
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  if (!query.title.trim() || !(query.episode > 0)) {
    return [];
  }
  const cache = readCache();

  const idKey = `mal:${normalizeName(query.title)}`;
  let idEntry = cache[idKey];
  const idTtl = idEntry && idEntry.value === null ? COMMUNITY_SKIP_MISS_TTL_MS : COMMUNITY_SKIP_TTL_MS;
  if (!idEntry || now - idEntry.fetchedAt > idTtl) {
    const search = await fetchJson(`${JIKAN_URL}?q=${encodeURIComponent(query.title)}&limit=5`);
    idEntry = {value: pickMalId(search?.data || [], query.title) ?? null, fetchedAt: now};
    cache[idKey] = idEntry;
    writeCache(cache);
  }
  if (idEntry.value === null) {
    return [];
  }

  const skipKey = `skip:${idEntry.value}:${query.episode}`;
  const cached = cache[skipKey];
  if (cached && now - cached.fetchedAt <= COMMUNITY_SKIP_TTL_MS) {
    return cached.value as SkipInterval[];
  }
  const data = await fetchJson(
    `${ANISKIP_URL}/${idEntry.value}/${query.episode}?types=op&types=ed&types=recap&episodeLength=0`,
  );
  const intervals = toSkipIntervals(data);
  cache[skipKey] = {value: intervals, fetchedAt: now};
  writeCache(cache);
  return intervals;
};
