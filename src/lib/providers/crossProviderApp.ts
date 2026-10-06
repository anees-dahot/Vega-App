import {providerManager} from '../services/ProviderManager';
import {fetchEpisodeStreams} from '../hooks/useStream';
import {
  findTitleOnProviders,
  resolveEpisodeOnProvider,
  type AlternativeEpisode,
  type ProviderRef,
  type SearchFn,
} from './crossProvider';
import type {Stream} from './types';

/** The pieces of crossProvider wired to the app's providers. */

export const searchOnProvider: SearchFn = (providerValue, query, signal) =>
  providerManager.getSearchPosts({
    searchQuery: query,
    page: 1,
    providerValue,
    signal: signal ?? new AbortController().signal,
  });

export interface FoundAlternative {
  alternative: AlternativeEpisode;
  streams: Stream[];
}

/**
 * The same episode on another provider that has streams for it, or null.
 * Providers whose title matches exactly are tried first.
 */
export const findAlternativeEpisode = async ({
  title,
  type,
  season,
  episodeNumber,
  excludeValue,
  providers,
  signal,
}: {
  title: string;
  type: string;
  season?: number;
  episodeNumber?: number;
  excludeValue?: string;
  providers: ProviderRef[];
  signal?: AbortSignal;
}): Promise<FoundAlternative | null> => {
  const matches = (
    await findTitleOnProviders({
      title,
      providers,
      search: searchOnProvider,
      excludeValue,
      signal,
    })
  ).sort((a, b) => Number(b.exact) - Number(a.exact));

  for (const match of matches) {
    if (signal?.aborted) {
      return null;
    }
    try {
      const alternative = await resolveEpisodeOnProvider({
        match,
        type,
        season,
        episodeNumber,
        getInfo: (link, providerValue) =>
          providerManager.getMetaData({link, provider: providerValue}),
        getEpisodes: (url, providerValue) =>
          providerManager.getEpisodes({url, providerValue}),
      });
      if (!alternative) {
        continue;
      }
      const streams = await fetchEpisodeStreams(
        alternative.episodeList[alternative.linkIndex],
        {type, providerValue: alternative.providerValue},
        alternative.providerValue,
      );
      if (streams.length > 0) {
        return {alternative, streams};
      }
    } catch {
      // This provider cannot help; try the next one.
    }
  }
  return null;
};
