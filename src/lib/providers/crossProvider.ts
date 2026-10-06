import {mainStorage} from '../storage/StorageService';
import {titleSimilarity} from '../trackers/match';
import {parseEpisodeNumber, parseSeasonNumber} from '../download/duplicates';
import type {EpisodeLink, Info, Link, Post} from './types';

/**
 * Finding the same title on other providers: which ones have it, and, when a
 * video will not play, the same episode on another one. A wrong match plays
 * the wrong show, so matching is strict: remakes, sequels and other seasons
 * ("Titanic II", "Season 2") do not count as the same title.
 */

const ROMAN = new Set(['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
const MARKER_WORDS = new Set([
  'part', 'season', 'movie', 'film', 'ova', 'ona', 'special', 'specials', 'final', 'remake', 'reboot',
]);

const clean = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\(\s*(?:19|20)\d{2}\s*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The numbers and words that tell one entry of a franchise from another. */
const markers = (value: string): string[] =>
  clean(value)
    .split(' ')
    .filter(token => /^\d+$/.test(token) || ROMAN.has(token) || MARKER_WORDS.has(token))
    // A year in the name ("Dune 2021") says nothing about which entry it is.
    .filter(token => !/^(?:19|20)\d{2}$/.test(token))
    .sort();

/** The name without its year, which providers add or leave out as they like. */
const withoutYear = (value: string): string =>
  clean(value).replace(/\s+(?:19|20)\d{2}$/, '');

export const STRICT_THRESHOLD = 0.88;

/** Whether two names are the same title, not just alike. */
export const isSameTitle = (
  wanted: string,
  candidate: string,
  threshold = STRICT_THRESHOLD,
): boolean => {
  const a = markers(wanted);
  const b = markers(candidate);
  if (a.length !== b.length || a.some((token, index) => token !== b[index])) {
    return false;
  }
  return titleSimilarity(withoutYear(wanted), withoutYear(candidate)) >= threshold;
};

/** The post that is the same title as `title`, the closest first. Null when none is. */
export const pickSameTitle = (title: string, posts: Post[]): Post | null => {
  let best: {post: Post; score: number} | null = null;
  for (const post of posts) {
    if (!post?.title || !post.link || !isSameTitle(title, post.title)) {
      continue;
    }
    const score =
      titleSimilarity(withoutYear(title), withoutYear(post.title)) +
      (post.title.trim().toLowerCase() === title.trim().toLowerCase() ? 0.01 : 0);
    if (!best || score > best.score) {
      best = {post, score};
    }
  }
  return best ? best.post : null;
};

export interface ProviderRef {
  value: string;
  display_name: string;
}

export interface ProviderMatch {
  providerValue: string;
  providerName: string;
  post: Post;
  /** The names are identical once punctuation and case are ignored. */
  exact: boolean;
}

export type SearchFn = (
  providerValue: string,
  query: string,
  signal?: AbortSignal,
) => Promise<Post[]>;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/** Searches every given provider at once. A provider that fails or is slow is left out. */
export const findTitleOnProviders = async ({
  title,
  providers,
  search,
  excludeValue,
  signal,
  timeoutMs = 20000,
}: {
  title: string;
  providers: ProviderRef[];
  search: SearchFn;
  excludeValue?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ProviderMatch[]> => {
  const query = title.trim();
  if (!query) {
    return [];
  }
  const results = await Promise.all(
    providers
      .filter(provider => provider.value !== excludeValue)
      .map(async (provider): Promise<ProviderMatch | null> => {
        try {
          const posts = await withTimeout(search(provider.value, query, signal), timeoutMs);
          const post = pickSameTitle(query, posts || []);
          return post
            ? {
                providerValue: provider.value,
                providerName: provider.display_name,
                post,
                exact: withoutYear(post.title) === withoutYear(query),
              }
            : null;
        } catch {
          return null;
        }
      }),
  );
  return results.filter((match): match is ProviderMatch => match !== null);
};

const AVAILABILITY_KEY = 'providerAvailability';
export const AVAILABILITY_TTL_MS = 12 * 60 * 60 * 1000;

interface CachedAvailability {
  at: number;
  matches: ProviderMatch[];
}

export const getCachedAvailability = (
  title: string,
  now: number = Date.now(),
): ProviderMatch[] | undefined => {
  const all = mainStorage.getObject<Record<string, CachedAvailability>>(AVAILABILITY_KEY) || {};
  const entry = all[clean(title)];
  return entry && now - entry.at < AVAILABILITY_TTL_MS ? entry.matches : undefined;
};

export const setCachedAvailability = (
  title: string,
  matches: ProviderMatch[],
  now: number = Date.now(),
): void => {
  const all = mainStorage.getObject<Record<string, CachedAvailability>>(AVAILABILITY_KEY) || {};
  all[clean(title)] = {at: now, matches};
  // Keep the cache small: drop the oldest entries beyond 40 titles.
  const keys = Object.keys(all).sort((x, y) => all[y].at - all[x].at);
  keys.slice(40).forEach(key => delete all[key]);
  mainStorage.setObject(AVAILABILITY_KEY, all);
};

/** The season or quality group of a title's page that holds the wanted season. */
export const pickSeasonGroup = (links: Link[], season?: number): Link | undefined => {
  const groups = (links || []).filter(Boolean);
  if (groups.length === 0) {
    return undefined;
  }
  const numbered = groups.filter(group => parseSeasonNumber(group.title) !== undefined);
  if (season !== undefined) {
    const found = groups.find(group => parseSeasonNumber(group.title) === season);
    if (found) {
      return found;
    }
    // Not numbered at all, and the first season was asked for: the only group is it.
    return numbered.length === 0 && season === 1 ? groups[0] : undefined;
  }
  return groups[0];
};

/**
 * The wanted episode in a list. `exact` is false when it was found by place
 * in the list instead of by its number, which is a guess.
 */
export const pickEpisode = (
  list: EpisodeLink[],
  wanted: {number?: number},
): {index: number; exact: boolean} | undefined => {
  if (!list.length) {
    return undefined;
  }
  if (wanted.number === undefined) {
    return list.length === 1 ? {index: 0, exact: true} : undefined;
  }
  const byNumber = list.findIndex(item => parseEpisodeNumber(item.title) === wanted.number);
  if (byNumber >= 0) {
    return {index: byNumber, exact: true};
  }
  const anyNumbered = list.some(item => parseEpisodeNumber(item.title) !== undefined);
  if (!anyNumbered && wanted.number >= 1 && wanted.number <= list.length) {
    return {index: wanted.number - 1, exact: false};
  }
  return undefined;
};

export interface AlternativeEpisode {
  providerValue: string;
  providerName: string;
  infoUrl: string;
  seasonTitle: string;
  episodeList: EpisodeLink[];
  linkIndex: number;
  /** True when the title, season and episode number all matched without guessing. */
  certain: boolean;
}

/** The same episode (or movie) on one provider's page for the title. Null when it cannot be found for sure. */
export const resolveEpisodeOnProvider = async ({
  match,
  type,
  season,
  episodeNumber,
  getInfo,
  getEpisodes,
}: {
  match: ProviderMatch;
  type: string;
  season?: number;
  episodeNumber?: number;
  getInfo: (link: string, providerValue: string) => Promise<Info>;
  getEpisodes: (url: string, providerValue: string) => Promise<EpisodeLink[]>;
}): Promise<AlternativeEpisode | null> => {
  const info = await getInfo(match.post.link, match.providerValue);
  const isMovie = type !== 'series';
  const group = pickSeasonGroup(info?.linkList || [], isMovie ? undefined : season);
  if (!group) {
    return null;
  }
  let list: EpisodeLink[] = [];
  if (group.directLinks?.length) {
    list = group.directLinks as EpisodeLink[];
  } else if (group.episodesLink) {
    list = await getEpisodes(group.episodesLink, match.providerValue);
  }
  list = list.filter(item => item?.link);
  if (!list.length) {
    return null;
  }
  const found = isMovie ? {index: 0, exact: true} : pickEpisode(list, {number: episodeNumber});
  if (!found) {
    return null;
  }
  return {
    providerValue: match.providerValue,
    providerName: match.providerName,
    infoUrl: match.post.link,
    seasonTitle: group.title,
    episodeList: list,
    linkIndex: found.index,
    certain:
      found.exact &&
      match.exact &&
      (isMovie || season !== undefined || (info.linkList || []).length === 1),
  };
};
