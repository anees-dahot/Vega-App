import {mainStorage} from '../storage/StorageService';

/**
 * When the next episode of a library show airs, from TMDB. A show is found by
 * its title; both the match and the dates are kept for a while so opening the
 * calendar does not search again every time.
 */

export interface AiringEpisode {
  /** Air date as YYYY-MM-DD. */
  date: string;
  season: number;
  episode: number;
  name?: string;
}

export interface AiringEntry {
  link: string;
  title: string;
  poster?: string;
  /** TMDB's own status, such as "Returning Series" or "Ended". */
  status?: string;
  next?: AiringEpisode;
  last?: AiringEpisode;
}

interface CachedEntry {
  tmdbId: number | null;
  poster?: string;
  status?: string;
  next?: AiringEpisode;
  last?: AiringEpisode;
  fetchedAt: number;
}

const CACHE_KEY = 'airingCalendarCache';
export const AIRING_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** A title TMDB does not know is not searched again for a week. */
export const AIRING_NO_MATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_AIRING_TITLES = 40;
const TMDB_URL = 'https://api.themoviedb.org/3';

export const normalizeTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\(\d{4}\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The TMDB result that is the same show: an exact name match, else the first result. */
export const pickTmdbMatch = <T extends {name?: string; original_name?: string}>(
  results: T[],
  title: string,
): T | undefined => {
  const wanted = normalizeTitle(title);
  return (
    results.find(
      result =>
        normalizeTitle(result.name || '') === wanted ||
        normalizeTitle(result.original_name || '') === wanted,
    ) ?? results[0]
  );
};

const toEpisode = (raw: any): AiringEpisode | undefined =>
  raw?.air_date
    ? {
        date: String(raw.air_date),
        season: Number(raw.season_number) || 0,
        episode: Number(raw.episode_number) || 0,
        name: raw.name || undefined,
      }
    : undefined;

type FetchJson = (url: string) => Promise<any>;

const defaultFetchJson: FetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status})`);
  }
  return response.json();
};

const readCache = (): Record<string, CachedEntry> =>
  mainStorage.getObject<Record<string, CachedEntry>>(CACHE_KEY) || {};

const isFresh = (entry: CachedEntry | undefined, now: number): entry is CachedEntry =>
  Boolean(
    entry &&
      now - entry.fetchedAt < (entry.tmdbId === null ? AIRING_NO_MATCH_TTL_MS : AIRING_CACHE_TTL_MS),
  );

export const loadAiringEntries = async (
  items: Array<{link: string; title: string; poster?: string}>,
  options: {apiKey: string; now?: number; fetchJson?: FetchJson; force?: boolean},
): Promise<AiringEntry[]> => {
  const now = options.now ?? Date.now();
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const cache = readCache();
  const entries: AiringEntry[] = [];
  const queue = items.slice(0, MAX_AIRING_TITLES);

  const lookup = async (item: (typeof queue)[number]): Promise<void> => {
    let cached = cache[item.link];
    if (options.force || !isFresh(cached, now)) {
      try {
        const search = await fetchJson(
          `${TMDB_URL}/search/tv?api_key=${options.apiKey}&query=${encodeURIComponent(item.title)}`,
        );
        const match = pickTmdbMatch<any>(search?.results || [], item.title);
        if (!match) {
          cached = {tmdbId: null, fetchedAt: now};
        } else {
          const details = await fetchJson(`${TMDB_URL}/tv/${match.id}?api_key=${options.apiKey}`);
          cached = {
            tmdbId: match.id,
            poster: details?.poster_path
              ? `https://image.tmdb.org/t/p/w185${details.poster_path}`
              : undefined,
            status: details?.status,
            next: toEpisode(details?.next_episode_to_air),
            last: toEpisode(details?.last_episode_to_air),
            fetchedAt: now,
          };
        }
        cache[item.link] = cached;
      } catch {
        // Keep an older answer when the request fails.
        if (!cached) {
          return;
        }
      }
    }
    if (cached && cached.tmdbId !== null) {
      entries.push({
        link: item.link,
        title: item.title,
        poster: item.poster || cached.poster,
        status: cached.status,
        next: cached.next,
        last: cached.last,
      });
    }
  };

  // A few at a time, to stay well within TMDB's limits.
  const workers = Array.from({length: Math.min(3, queue.length)}, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) {
        await lookup(item);
      }
    }
  });
  await Promise.all(workers);
  mainStorage.setObject(CACHE_KEY, cache);
  return entries;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / DAY_MS);
};

/** Days from `today` (YYYY-MM-DD) to `date`: positive is in the future. */
export const daysUntil = (date: string, today: string): number =>
  dayNumber(date) - dayNumber(today);

export const describeAirDay = (date: string, today: string): string => {
  const days = daysUntil(date, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return date;
};

export interface CalendarSection {
  title: string;
  entries: Array<AiringEntry & {episode: AiringEpisode; day: string}>;
}

export const toLocalDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Upcoming episodes by when they air, then episodes from the last week. */
export const buildCalendar = (entries: AiringEntry[], today: string): CalendarSection[] => {
  const upcoming: CalendarSection['entries'] = [];
  const recent: CalendarSection['entries'] = [];
  for (const entry of entries) {
    if (entry.next && daysUntil(entry.next.date, today) >= 0) {
      upcoming.push({...entry, episode: entry.next, day: describeAirDay(entry.next.date, today)});
    }
    if (entry.last) {
      const days = daysUntil(entry.last.date, today);
      if (days < 0 && days >= -7) {
        recent.push({...entry, episode: entry.last, day: describeAirDay(entry.last.date, today)});
      }
    }
  }
  upcoming.sort((a, b) => a.episode.date.localeCompare(b.episode.date) || a.title.localeCompare(b.title));
  recent.sort((a, b) => b.episode.date.localeCompare(a.episode.date) || a.title.localeCompare(b.title));

  const group = (from: number, to: number) =>
    upcoming.filter(entry => {
      const days = daysUntil(entry.episode.date, today);
      return days >= from && days <= to;
    });
  const sections: CalendarSection[] = [
    {title: 'Today', entries: group(0, 0)},
    {title: 'This week', entries: group(1, 6)},
    {title: 'Later', entries: upcoming.filter(entry => daysUntil(entry.episode.date, today) >= 7)},
    {title: 'Aired this week', entries: recent},
  ];
  return sections.filter(section => section.entries.length > 0);
};

export const formatEpisodeCode = (episode: AiringEpisode): string =>
  `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`;
