import {mainStorage} from '../storage/StorageService';
import type {StoredTrackerId, TrackerId} from './types';

/** What the app keeps about each tracker: the user's client id and sign-in. Never part of a backup. */

const key = (tracker: StoredTrackerId, field: string) => `tracker.${tracker}.${field}`;

export interface TrackerAuth {
  accessToken: string;
  refreshToken?: string;
  /** Milliseconds since 1970 when the token stops working, if known. */
  expiresAt?: number;
}

export const getTrackerClientId = (tracker: StoredTrackerId): string =>
  mainStorage.getString(key(tracker, 'clientId')) || '';

export const setTrackerClientId = (tracker: StoredTrackerId, clientId: string): void =>
  mainStorage.setString(key(tracker, 'clientId'), clientId.trim());

export const getTrackerAuth = (tracker: StoredTrackerId): TrackerAuth | undefined => {
  const accessToken = mainStorage.getString(key(tracker, 'token'));
  if (!accessToken) {
    return undefined;
  }
  return {
    accessToken,
    refreshToken: mainStorage.getString(key(tracker, 'refresh')) || undefined,
    expiresAt: mainStorage.getNumber(key(tracker, 'expiresAtSeconds'))
      ? (mainStorage.getNumber(key(tracker, 'expiresAtSeconds')) as number) * 1000
      : undefined,
  };
};

export const setTrackerAuth = (tracker: StoredTrackerId, auth: TrackerAuth): void => {
  mainStorage.setString(key(tracker, 'token'), auth.accessToken);
  if (auth.refreshToken) {
    mainStorage.setString(key(tracker, 'refresh'), auth.refreshToken);
  }
  if (auth.expiresAt) {
    mainStorage.setNumber(key(tracker, 'expiresAtSeconds'), Math.floor(auth.expiresAt / 1000));
  }
};

export const clearTrackerAuth = (tracker: StoredTrackerId): void => {
  ['token', 'refresh', 'expiresAtSeconds', 'user'].forEach(field => mainStorage.delete(key(tracker, field)));
};

export const getTrackerUser = (tracker: StoredTrackerId): string => mainStorage.getString(key(tracker, 'user')) || '';

export const setTrackerUser = (tracker: StoredTrackerId, name: string): void =>
  mainStorage.setString(key(tracker, 'user'), name);

/** Pending sign-in: the secret that proves the app that started it finished it (MyAnimeList). */
export const getPendingOAuth = (tracker: TrackerId): {verifier: string; state: string} | undefined => {
  const verifier = mainStorage.getString(key(tracker, 'pendingVerifier'));
  const state = mainStorage.getString(key(tracker, 'pendingState'));
  return verifier && state ? {verifier, state} : undefined;
};

export const setPendingOAuth = (tracker: TrackerId, pending: {verifier: string; state: string}): void => {
  mainStorage.setString(key(tracker, 'pendingVerifier'), pending.verifier);
  mainStorage.setString(key(tracker, 'pendingState'), pending.state);
};

export const clearPendingOAuth = (tracker: TrackerId): void => {
  mainStorage.delete(key(tracker, 'pendingVerifier'));
  mainStorage.delete(key(tracker, 'pendingState'));
};

export const isTrackerSyncEnabled = (tracker: StoredTrackerId): boolean =>
  mainStorage.getBool(key(tracker, 'sync'), true);

export const setTrackerSyncEnabled = (tracker: StoredTrackerId, enabled: boolean): void =>
  mainStorage.setBool(key(tracker, 'sync'), enabled);

/** Trakt's device sign-in needs the client secret as well as the id. */
export const getTrackerClientSecret = (tracker: StoredTrackerId): string =>
  mainStorage.getString(key(tracker, 'clientSecret')) || '';

export const setTrackerClientSecret = (tracker: StoredTrackerId, secret: string): void =>
  mainStorage.setString(key(tracker, 'clientSecret'), secret.trim());
