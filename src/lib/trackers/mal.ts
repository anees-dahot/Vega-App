import {pickBestMatch} from './match';
import {
  getTrackerAuth,
  getTrackerClientId,
  setTrackerAuth,
} from './storage';
import type {FetchLike, TrackerClient, TrackerEntryUpdate, TrackerMedia, TrackerStatus} from './types';

const API_URL = 'https://api.myanimelist.net/v2';
export const MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';

const STATUS: Record<TrackerStatus, string> = {
  watching: 'watching',
  planned: 'plan_to_watch',
  completed: 'completed',
  dropped: 'dropped',
  paused: 'on_hold',
};

/** Trade the refresh token for a new access token. Returns false when that is not possible. */
export const refreshMalToken = async (
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<boolean> => {
  const auth = getTrackerAuth('mal');
  const clientId = getTrackerClientId('mal');
  if (!auth?.refreshToken || !clientId) {
    return false;
  }
  const response = await fetchImpl(MAL_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `client_id=${encodeURIComponent(clientId)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
  });
  if (!response.ok) {
    return false;
  }
  const body = await response.json();
  if (!body?.access_token) {
    return false;
  }
  setTrackerAuth('mal', {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || auth.refreshToken,
    expiresAt: body.expires_in ? now() + Number(body.expires_in) * 1000 : undefined,
  });
  return true;
};

export const createMalClient = (
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): TrackerClient => {
  const request = async (path: string, init: any = {}, retried = false): Promise<any> => {
    let auth = getTrackerAuth('mal');
    if (!auth) {
      throw new Error('MyAnimeList is not connected');
    }
    // A token that is about to run out is replaced first.
    if (auth.expiresAt && auth.expiresAt - now() < 60_000 && !retried) {
      await refreshMalToken(fetchImpl, now);
      auth = getTrackerAuth('mal') || auth;
    }
    const response = await fetchImpl(`${API_URL}${path}`, {
      ...init,
      headers: {Authorization: `Bearer ${auth.accessToken}`, ...(init.headers || {})},
    });
    if (response.status === 401 && !retried && (await refreshMalToken(fetchImpl, now))) {
      return request(path, init, true);
    }
    if (!response.ok) {
      throw new Error(`MyAnimeList request failed (${response.status})`);
    }
    return response.json().catch(() => null);
  };

  return {
    id: 'mal',
    name: 'MyAnimeList',
    isConnected: () => Boolean(getTrackerAuth('mal')),

    async findMedia(title): Promise<TrackerMedia | null> {
      const data = await request(
        `/anime?q=${encodeURIComponent(title.slice(0, 64))}&limit=8&fields=alternative_titles,num_episodes`,
      );
      const nodes = (data?.data || []).map((entry: any) => entry.node);
      const match = pickBestMatch<any>(title, nodes, node => [
        node.title,
        node.alternative_titles?.en,
        node.alternative_titles?.ja,
        ...(node.alternative_titles?.synonyms || []),
      ]);
      return match
        ? {
            id: match.id,
            title: match.alternative_titles?.en || match.title,
            episodes: match.num_episodes > 0 ? match.num_episodes : undefined,
          }
        : null;
    },

    async saveEntry(mediaId: number, update: TrackerEntryUpdate): Promise<void> {
      const fields: string[] = [];
      if (update.status) fields.push(`status=${STATUS[update.status]}`);
      if (typeof update.progress === 'number') fields.push(`num_watched_episodes=${update.progress}`);
      if (update.score10) fields.push(`score=${update.score10}`);
      if (fields.length === 0) {
        return;
      }
      await request(`/anime/${mediaId}/my_list_status`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: fields.join('&'),
      });
    },
  };
};
