import {pickBestMatch} from './match';
import {getTrackerAuth} from './storage';
import type {FetchLike, TrackerClient, TrackerEntryUpdate, TrackerMedia, TrackerStatus} from './types';

const API_URL = 'https://graphql.anilist.co';

const STATUS: Record<TrackerStatus, string> = {
  watching: 'CURRENT',
  planned: 'PLANNING',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
  paused: 'PAUSED',
};

export const createAniListClient = (fetchImpl: FetchLike = fetch as unknown as FetchLike): TrackerClient => {
  const request = async (query: string, variables: Record<string, unknown>) => {
    const auth = getTrackerAuth('anilist');
    if (!auth) {
      throw new Error('AniList is not connected');
    }
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({query, variables}),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.errors) {
      throw new Error(body?.errors?.[0]?.message || `AniList request failed (${response.status})`);
    }
    return body?.data;
  };

  return {
    id: 'anilist',
    name: 'AniList',
    isConnected: () => Boolean(getTrackerAuth('anilist')),

    async findMedia(title): Promise<TrackerMedia | null> {
      const data = await request(
        `query ($search: String) {
          Page(perPage: 8) {
            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
              id episodes title { romaji english native } synonyms
            }
          }
        }`,
        {search: title},
      );
      const match = pickBestMatch<any>(title, data?.Page?.media || [], media => [
        media.title?.romaji,
        media.title?.english,
        media.title?.native,
        ...(media.synonyms || []),
      ]);
      return match
        ? {
            id: match.id,
            title: match.title?.english || match.title?.romaji || title,
            episodes: typeof match.episodes === 'number' ? match.episodes : undefined,
          }
        : null;
    },

    async saveEntry(mediaId: number, update: TrackerEntryUpdate): Promise<void> {
      await request(
        `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $score: Int) {
          SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, scoreRaw: $score) { id }
        }`,
        {
          mediaId,
          progress: update.progress,
          status: update.status ? STATUS[update.status] : undefined,
          // AniList's raw score is out of 100, whatever format the user shows.
          score: update.score10 ? update.score10 * 10 : undefined,
        },
      );
    },
  };
};

/** The signed-in user's name, to show in settings and to check a token works. */
export const fetchAniListUser = async (
  accessToken: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> => {
  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({query: 'query { Viewer { name } }'}),
  });
  const body = await response.json().catch(() => null);
  const name = body?.data?.Viewer?.name;
  if (!response.ok || !name) {
    throw new Error('AniList did not accept the sign-in');
  }
  return name;
};
