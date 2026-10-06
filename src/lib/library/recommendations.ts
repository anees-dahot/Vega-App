import {mainStorage} from '../storage/StorageService';
import type {WatchListItem} from '../storage/WatchListStorage';
import {normalizeTitle} from './airingCalendar';

/**
 * "Because you watched": titles TMDB lists as similar to the ones in the
 * library the user rated highly or finished, leaving out what is saved already.
 */

export interface Recommendation {
  id: number;
  mediaType: 'tv' | 'movie';
  title: string;
  year?: string;
  poster?: string;
  /** The library title it came from, e.g. "Because you liked Naruto". */
  because: string;
  score: number;
}

interface CachedSeed {
  tmdbId: number | null;
  mediaType?: 'tv' | 'movie';
  recommendations: Array<{
    id: number;
    mediaType: 'tv' | 'movie';
    title: string;
    year?: string;
    poster?: string;
    popularity?: number;
  }>;
  fetchedAt: number;
}

const CACHE_KEY = 'recommendationSeeds';
export const RECOMMENDATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_SEEDS = 5;
export const MAX_RECOMMENDATIONS = 24;
const TMDB_URL = 'https://api.themoviedb.org/3';

/** The library titles to base recommendations on: top rated first, then finished or watching. */
export const pickSeedTitles = (items: WatchListItem[], limit = MAX_SEEDS): WatchListItem[] => {
  const weight = (item: WatchListItem): number => {
    if (typeof item.rating === 'number' && item.rating >= 8) return 100 + item.rating;
    if (item.status === 'finished') return 60;
    if (item.status === 'watching') return 40;
    return 0;
  };
  return items
    .map((item, index) => ({item, index, weight: weight(item)}))
    .filter(entry => entry.weight > 0)
    // Equal weights: the title added more recently comes first.
    .sort((a, b) => b.weight - a.weight || b.index - a.index)
    .slice(0, limit)
    .map(entry => entry.item);
};

/**
 * Combine each seed's list into one: a title earns more when it is high in a
 * list, when several seeds point to it, and when its seed was loved most.
 */
export const rankRecommendations = (
  seeds: Array<{title: string; weight: number; list: CachedSeed['recommendations']}>,
  libraryTitles: string[],
  limit = MAX_RECOMMENDATIONS,
): Recommendation[] => {
  const owned = new Set(libraryTitles.map(normalizeTitle));
  const byId = new Map<string, Recommendation>();
  for (const seed of seeds) {
    seed.list.forEach((entry, index) => {
      if (owned.has(normalizeTitle(entry.title))) {
        return;
      }
      const key = `${entry.mediaType}:${entry.id}`;
      const points = (seed.weight / 100) * (1 - index / 25);
      const existing = byId.get(key);
      if (existing) {
        existing.score += points;
      } else {
        byId.set(key, {
          id: entry.id,
          mediaType: entry.mediaType,
          title: entry.title,
          year: entry.year,
          poster: entry.poster,
          because: `Because you liked ${seed.title}`,
          score: points,
        });
      }
    });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
};

type FetchJson = (url: string) => Promise<any>;

const defaultFetchJson: FetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status})`);
  }
  return response.json();
};

const year = (date?: string): string | undefined => (date ? date.slice(0, 4) : undefined);

export const loadRecommendations = async (
  library: WatchListItem[],
  options: {apiKey: string; now?: number; fetchJson?: FetchJson},
): Promise<Recommendation[]> => {
  const now = options.now ?? Date.now();
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const cache = mainStorage.getObject<Record<string, CachedSeed>>(CACHE_KEY) || {};
  const seeds = pickSeedTitles(library);
  const results: Array<{title: string; weight: number; list: CachedSeed['recommendations']}> = [];

  for (const seed of seeds) {
    let cached = cache[seed.link];
    if (!cached || now - cached.fetchedAt > RECOMMENDATION_TTL_MS) {
      try {
        const search = await fetchJson(
          `${TMDB_URL}/search/multi?api_key=${options.apiKey}&query=${encodeURIComponent(seed.title)}`,
        );
        const match = (search?.results || []).find(
          (item: any) => item.media_type === 'tv' || item.media_type === 'movie',
        );
        if (!match) {
          cached = {tmdbId: null, recommendations: [], fetchedAt: now};
        } else {
          const mediaType: 'tv' | 'movie' = match.media_type;
          const data = await fetchJson(
            `${TMDB_URL}/${mediaType}/${match.id}/recommendations?api_key=${options.apiKey}`,
          );
          cached = {
            tmdbId: match.id,
            mediaType,
            fetchedAt: now,
            recommendations: (data?.results || []).map((item: any) => ({
              id: item.id,
              mediaType,
              title: item.name || item.title || '',
              year: year(item.first_air_date || item.release_date),
              poster: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : undefined,
              popularity: item.popularity,
            })),
          };
        }
        cache[seed.link] = cached;
      } catch {
        if (!cached) {
          continue;
        }
      }
    }
    const weight = typeof seed.rating === 'number' && seed.rating >= 8 ? 100 + seed.rating : seed.status === 'finished' ? 60 : 40;
    results.push({title: seed.title, weight, list: cached.recommendations.filter(item => item.title)});
  }
  mainStorage.setObject(CACHE_KEY, cache);
  return rankRecommendations(results, library.map(item => item.title));
};
