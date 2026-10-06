import * as Crypto from 'expo-crypto';
import {fetchAniListUser} from './anilist';
import {MAL_TOKEN_URL} from './mal';
import {
  clearPendingOAuth,
  getPendingOAuth,
  getTrackerClientId,
  setPendingOAuth,
  setTrackerAuth,
  setTrackerUser,
} from './storage';
import type {FetchLike, TrackerId} from './types';

/**
 * Signing in to a tracker through the browser. The user makes their own API
 * client on the site and gives its client id to the app; the site sends them
 * back to the app with a token (AniList) or a code (MyAnimeList).
 */

const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** A random string of letters, digits and "-._~". */
export const randomString = (length: number): string => {
  const bytes = Crypto.getRandomBytes(length);
  return Array.from(bytes, byte => VERIFIER_CHARS[byte % VERIFIER_CHARS.length]).join('');
};

/** The address the site sends the user back to. It must be added to the client on the site. */
export const getRedirectUri = (tracker: TrackerId, scheme: string): string =>
  `${scheme}://oauth/${tracker}`;

export const buildAniListAuthUrl = (clientId: string): string =>
  `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;

/** MyAnimeList only supports the "plain" PKCE method: the challenge is the verifier itself. */
export const buildMalAuthUrl = (
  clientId: string,
  verifier: string,
  state: string,
  redirectUri: string,
): string =>
  `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(
    clientId,
  )}&code_challenge=${verifier}&code_challenge_method=plain&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

export interface ParsedRedirect {
  tracker: TrackerId;
  params: Record<string, string>;
}

/** Reads "scheme://oauth/<tracker>" with its query and fragment, or null for any other address. */
export const parseOAuthRedirect = (url: string): ParsedRedirect | null => {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/oauth\/(anilist|mal)\/?([?#].*)?$/i);
  if (!match) {
    return null;
  }
  const params: Record<string, string> = {};
  (match[2] || '')
    .replace(/^[?#]/, '')
    .split(/[&#?]/)
    .filter(Boolean)
    .forEach(pair => {
      const index = pair.indexOf('=');
      const name = index < 0 ? pair : pair.slice(0, index);
      const value = index < 0 ? '' : pair.slice(index + 1);
      try {
        params[decodeURIComponent(name)] = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {
        params[name] = value;
      }
    });
  return {tracker: match[1].toLowerCase() as TrackerId, params};
};

/** The address to open in the browser to start signing in. Throws when there is no client id. */
export const startOAuth = (tracker: TrackerId, scheme: string): string => {
  const clientId = getTrackerClientId(tracker);
  if (!clientId) {
    throw new Error('Enter your client id first');
  }
  if (tracker === 'anilist') {
    return buildAniListAuthUrl(clientId);
  }
  const pending = {verifier: randomString(64), state: randomString(16)};
  setPendingOAuth('mal', pending);
  return buildMalAuthUrl(clientId, pending.verifier, pending.state, getRedirectUri('mal', scheme));
};

export interface OAuthResult {
  tracker: TrackerId;
  user: string;
}

/** Finishes a sign-in from the address the site sent the user back to. Null when it is not one. */
export const completeOAuth = async (
  url: string,
  scheme: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<OAuthResult | null> => {
  const redirect = parseOAuthRedirect(url);
  if (!redirect) {
    return null;
  }
  const {tracker, params} = redirect;
  if (params.error) {
    clearPendingOAuth(tracker);
    throw new Error(params.error_description || `Sign-in was refused (${params.error})`);
  }

  if (tracker === 'anilist') {
    const token = params.access_token;
    if (!token) {
      throw new Error('AniList did not send a token');
    }
    const user = await fetchAniListUser(token, fetchImpl);
    setTrackerAuth('anilist', {
      accessToken: token,
      expiresAt: params.expires_in ? now() + Number(params.expires_in) * 1000 : undefined,
    });
    setTrackerUser('anilist', user);
    return {tracker, user};
  }

  const pending = getPendingOAuth('mal');
  if (!pending || pending.state !== params.state || !params.code) {
    throw new Error('This sign-in does not match the one that was started');
  }
  const response = await fetchImpl(MAL_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: [
      `client_id=${encodeURIComponent(getTrackerClientId('mal'))}`,
      'grant_type=authorization_code',
      `code=${encodeURIComponent(params.code)}`,
      `code_verifier=${pending.verifier}`,
      `redirect_uri=${encodeURIComponent(getRedirectUri('mal', scheme))}`,
    ].join('&'),
  });
  clearPendingOAuth('mal');
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new Error('MyAnimeList did not accept the sign-in');
  }
  setTrackerAuth('mal', {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? now() + Number(body.expires_in) * 1000 : undefined,
  });
  const me = await fetchImpl('https://api.myanimelist.net/v2/users/@me', {
    headers: {Authorization: `Bearer ${body.access_token}`},
  });
  const user = (await me.json().catch(() => null))?.name || 'MyAnimeList user';
  setTrackerUser('mal', user);
  return {tracker, user};
};
