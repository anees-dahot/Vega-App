import {mainStorage} from '../storage/StorageService';
import {pickBestMatch} from './match';
import {
  clearTrackerAuth,
  getTrackerAuth,
  getTrackerClientId,
  getTrackerClientSecret,
  isTrackerSyncEnabled,
  setTrackerAuth,
  setTrackerUser,
} from './storage';
import type {FetchLike} from './types';

/**
 * Trakt: marks what you watch in your Trakt history. Signing in uses the
 * device flow (a short code typed on trakt.tv), so no redirect address is
 * needed. The user makes their own API app on Trakt and gives its id and
 * secret to the app.
 */

export const TRAKT_URL = 'https://api.trakt.tv';
const MATCHES_KEY = 'traktMatches';
const SENT_KEY = 'traktSent';
export const TRAKT_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SENT = 2000;

const apiHeaders = (clientId: string, token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'trakt-api-version': '2',
  'trakt-api-key': clientId,
  ...(token ? {Authorization: `Bearer ${token}`} : {}),
});

export interface DeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  /** Seconds to wait between checks. */
  interval: number;
}

export type DevicePoll =
  | {status: 'pending'}
  | {status: 'slow'}
  | {status: 'denied'}
  | {status: 'expired'}
  | {status: 'ok'; user: string};

/** Newer Trakt apps are issued no secret; send one only when the user entered it. */
const secretField = (): {client_secret?: string} => {
  const secret = getTrackerClientSecret('trakt');
  return secret ? {client_secret: secret} : {};
};

export const startDeviceLogin = async (
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<DeviceLogin> => {
  const clientId = getTrackerClientId('trakt');
  if (!clientId) {
    throw new Error('Enter your Trakt client ID first');
  }
  const response = await fetchImpl(`${TRAKT_URL}/oauth/device/code`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_id: clientId}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.device_code) {
    throw new Error('Trakt did not accept the client ID');
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: body.verification_url || 'https://trakt.tv/activate',
    expiresAt: now() + Number(body.expires_in || 600) * 1000,
    interval: Math.max(Number(body.interval || 5), 1),
  };
};

const fetchTraktUser = async (token: string, fetchImpl: FetchLike): Promise<string> => {
  const response = await fetchImpl(`${TRAKT_URL}/users/settings`, {
    headers: apiHeaders(getTrackerClientId('trakt'), token),
  });
  const body = await response.json().catch(() => null);
  return body?.user?.username || body?.user?.name || 'Trakt user';
};

/** One check of whether the user has entered the code yet. */
export const pollDeviceLogin = async (
  login: DeviceLogin,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<DevicePoll> => {
  if (now() >= login.expiresAt) {
    return {status: 'expired'};
  }
  const response = await fetchImpl(`${TRAKT_URL}/oauth/device/token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      code: login.deviceCode,
      client_id: getTrackerClientId('trakt'),
      ...secretField(),
    }),
  });
  if (response.status === 400) {
    return {status: 'pending'};
  }
  if (response.status === 429) {
    return {status: 'slow'};
  }
  if (response.status === 418) {
    return {status: 'denied'};
  }
  if (response.status === 404 || response.status === 409 || response.status === 410) {
    return {status: 'expired'};
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new Error('Trakt did not accept the sign-in');
  }
  setTrackerAuth('trakt', {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? now() + Number(body.expires_in) * 1000 : undefined,
  });
  const user = await fetchTraktUser(body.access_token, fetchImpl);
  setTrackerUser('trakt', user);
  return {status: 'ok', user};
};

/** A token that is about to run out is replaced; false when that is not possible. */
export const refreshTraktToken = async (
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<boolean> => {
  const auth = getTrackerAuth('trakt');
  if (!auth?.refreshToken) {
    return false;
  }
  const response = await fetchImpl(`${TRAKT_URL}/oauth/token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      refresh_token: auth.refreshToken,
      client_id: getTrackerClientId('trakt'),
      ...secretField(),
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'refresh_token',
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    return false;
  }
  setTrackerAuth('trakt', {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || auth.refreshToken,
    expiresAt: body.expires_in ? now() + Number(body.expires_in) * 1000 : undefined,
  });
  return true;
};

export const isTraktConnected = (): boolean => Boolean(getTrackerAuth('trakt'));

export const disconnectTrakt = (): void => {
  clearTrackerAuth('trakt');
};

const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

const request = async (
  path: string,
  init: {method?: string; body?: unknown} = {},
  fetchImpl: FetchLike,
  now: () => number,
  retried = false,
): Promise<any> => {
  let auth = getTrackerAuth('trakt');
  if (!auth) {
    throw new Error('Trakt is not connected');
  }
  if (auth.expiresAt && auth.expiresAt - now() < REFRESH_MARGIN_MS && !retried) {
    if (await refreshTraktToken(fetchImpl, now)) {
      auth = getTrackerAuth('trakt') || auth;
    }
  }
  const response = await fetchImpl(`${TRAKT_URL}${path}`, {
    method: init.method || 'GET',
    headers: apiHeaders(getTrackerClientId('trakt'), auth.accessToken),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.status === 401 && !retried && (await refreshTraktToken(fetchImpl, now))) {
    return request(path, init, fetchImpl, now, true);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Trakt request failed (${response.status})`);
  }
  return body;
};

export interface TraktTitle {
  trakt: number;
  title: string;
  year?: number;
}

interface CachedMatch {
  title: TraktTitle | null;
  at: number;
}

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The Trakt entry for a title, found once and remembered. A title with no match is retried after a week. */
export const findTraktTitle = async (
  kind: 'show' | 'movie',
  title: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<TraktTitle | null> => {
  const key = `${kind}:${normalizeKey(title)}`;
  const cache = mainStorage.getObject<Record<string, CachedMatch>>(MATCHES_KEY) || {};
  const known = cache[key];
  if (known && (known.title || now() - known.at < TRAKT_MISS_TTL_MS)) {
    return known.title;
  }
  const results: any[] = await request(
    `/search/${kind}?query=${encodeURIComponent(title)}&limit=8`,
    {},
    fetchImpl,
    now,
  );
  const match = pickBestMatch<any>(title, Array.isArray(results) ? results : [], entry => [
    entry?.[kind]?.title,
  ]);
  const found: TraktTitle | null = match?.[kind]?.ids?.trakt
    ? {trakt: match[kind].ids.trakt, title: match[kind].title, year: match[kind].year}
    : null;
  cache[key] = {title: found, at: now()};
  mainStorage.setObject(MATCHES_KEY, cache);
  return found;
};

const markSent = (key: string): boolean => {
  const sent = mainStorage.getArray<string>(SENT_KEY) || [];
  if (sent.includes(key)) {
    return false;
  }
  sent.push(key);
  mainStorage.setArray(SENT_KEY, sent.slice(-MAX_SENT));
  return true;
};

const unmarkSent = (key: string): void => {
  const sent = mainStorage.getArray<string>(SENT_KEY) || [];
  mainStorage.setArray(
    SENT_KEY,
    sent.filter(entry => entry !== key),
  );
};

export type TraktOutcome = 'sent' | 'skipped' | 'not-found' | 'off';

/** Adds an episode to the Trakt history, once. Needs a season number: a wrong one would mark another episode. */
export const syncTraktEpisode = async (
  input: {title: string; season?: number; episode?: number},
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<TraktOutcome> => {
  if (!isTraktConnected() || !isTrackerSyncEnabled('trakt')) {
    return 'off';
  }
  if (!input.title.trim() || !(input.season! > 0) || !(input.episode! > 0)) {
    return 'skipped';
  }
  const show = await findTraktTitle('show', input.title, fetchImpl, now);
  if (!show) {
    return 'not-found';
  }
  const key = `s:${show.trakt}:${input.season}:${input.episode}`;
  if (!markSent(key)) {
    return 'skipped';
  }
  return request(
    '/sync/history',
    {
      method: 'POST',
      body: {
        shows: [
          {
            ids: {trakt: show.trakt},
            seasons: [
              {
                number: input.season,
                episodes: [{number: input.episode, watched_at: new Date(now()).toISOString()}],
              },
            ],
          },
        ],
      },
    },
    fetchImpl,
    now,
  ).then(
    () => 'sent' as const,
    error => {
      unmarkSent(key);
      throw error;
    },
  );
};

/** Adds a movie to the Trakt history, once. */
export const syncTraktMovie = async (
  input: {title: string},
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<TraktOutcome> => {
  if (!isTraktConnected() || !isTrackerSyncEnabled('trakt')) {
    return 'off';
  }
  if (!input.title.trim()) {
    return 'skipped';
  }
  const movie = await findTraktTitle('movie', input.title, fetchImpl, now);
  if (!movie) {
    return 'not-found';
  }
  const key = `m:${movie.trakt}`;
  if (!markSent(key)) {
    return 'skipped';
  }
  return request(
    '/sync/history',
    {
      method: 'POST',
      body: {movies: [{ids: {trakt: movie.trakt}, watched_at: new Date(now()).toISOString()}]},
    },
    fetchImpl,
    now,
  ).then(
    () => 'sent' as const,
    error => {
      unmarkSent(key);
      throw error;
    },
  );
};
