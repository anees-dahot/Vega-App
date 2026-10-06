import {mainStorage} from '../storage/StorageService';

/** "More like this": what TMDB lists as similar to one title, kept for a week. */

export interface SimilarTitle {
  id: number;
  mediaType: 'tv' | 'movie';
  title: string;
  year?: string;
  poster?: string;
}

const TMDB_URL = 'https://api.themoviedb.org/3';
const CACHE_KEY = 'similarTitles';
export const SIMILAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SIMILAR = 20;

type FetchJson = (url: string) => Promise<any>;

const defaultFetchJson: FetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status})`);
  }
  return response.json();
};

interface Cached {
  at: number;
  items: SimilarTitle[];
}

const toTitle = (entry: any, mediaType: 'tv' | 'movie'): SimilarTitle | null => {
  const title = entry?.name || entry?.title;
  if (!entry?.id || !title) {
    return null;
  }
  const date: string | undefined = entry.first_air_date || entry.release_date;
  return {
    id: entry.id,
    mediaType,
    title,
    year: date ? date.slice(0, 4) : undefined,
    poster: entry.poster_path ? `https://image.tmdb.org/t/p/w342${entry.poster_path}` : undefined,
  };
};

const resolveId = async (
  fetchJson: FetchJson,
  apiKey: string,
  input: {tmdbId?: number | string; imdbId?: string; type?: string},
): Promise<{id: number; mediaType: 'tv' | 'movie'} | null> => {
  const preferred: 'tv' | 'movie' = input.type === 'series' ? 'tv' : 'movie';
  const direct = Number(input.tmdbId);
  if (Number.isFinite(direct) && direct > 0) {
    return {id: direct, mediaType: preferred};
  }
  if (!input.imdbId) {
    return null;
  }
  const found = await fetchJson(
    `${TMDB_URL}/find/${encodeURIComponent(input.imdbId)}?api_key=${apiKey}&external_source=imdb_id`,
  );
  const tv = found?.tv_results?.[0];
  const movie = found?.movie_results?.[0];
  const pick = preferred === 'tv' ? (tv ? {entry: tv, type: 'tv' as const} : movie ? {entry: movie, type: 'movie' as const} : null)
    : (movie ? {entry: movie, type: 'movie' as const} : tv ? {entry: tv, type: 'tv' as const} : null);
  return pick ? {id: pick.entry.id, mediaType: pick.type} : null;
};

/** Titles similar to the given one, without the title itself. Empty when TMDB does not know it. */
export const loadSimilarTitles = async (
  input: {tmdbId?: number | string; imdbId?: string; type?: string; title?: string},
  options: {apiKey: string; now?: number; fetchJson?: FetchJson},
): Promise<SimilarTitle[]> => {
  const now = options.now ?? Date.now();
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const resolved = await resolveId(fetchJson, options.apiKey, input);
  if (!resolved) {
    return [];
  }
  const cacheKey = `${resolved.mediaType}:${resolved.id}`;
  const cache = mainStorage.getObject<Record<string, Cached>>(CACHE_KEY) || {};
  const cached = cache[cacheKey];
  if (cached && now - cached.at < SIMILAR_TTL_MS) {
    return cached.items;
  }
  const own = (input.title || '').trim().toLowerCase();
  const collect = async (path: 'recommendations' | 'similar') => {
    const data = await fetchJson(
      `${TMDB_URL}/${resolved.mediaType}/${resolved.id}/${path}?api_key=${options.apiKey}`,
    );
    return (data?.results || [])
      .map((entry: any) => toTitle(entry, resolved.mediaType))
      .filter((item: SimilarTitle | null): item is SimilarTitle => Boolean(item))
      .filter((item: SimilarTitle) => item.id !== resolved.id && item.title.toLowerCase() !== own);
  };
  let items: SimilarTitle[] = await collect('recommendations');
  if (items.length === 0) {
    items = await collect('similar');
  }
  items = items.slice(0, MAX_SIMILAR);
  cache[cacheKey] = {at: now, items};
  // Keep the cache small.
  Object.keys(cache)
    .sort((a, b) => cache[b].at - cache[a].at)
    .slice(60)
    .forEach(key => delete cache[key]);
  mainStorage.setObject(CACHE_KEY, cache);
  return items;
};
