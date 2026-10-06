import {mainStorage} from '../storage/StorageService';
import {createAniListClient} from './anilist';
import {createMalClient} from './mal';
import {isTrackerSyncEnabled} from './storage';
import {
  LIBRARY_TO_TRACKER_STATUS,
  type TrackerClient,
  type TrackerMedia,
} from './types';
import type {LibraryStatus} from '../storage/WatchListStorage';

/**
 * Keeps AniList and MyAnimeList up to date: episodes watched, and a library
 * title's status and score. It only ever moves progress forward.
 */

const MEDIA_KEY = 'trackerMediaMatches';
const PROGRESS_KEY = 'trackerSyncedProgress';
export const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface MediaMatch {
  media: TrackerMedia | null;
  at: number;
}

const normalize = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The tracker entry for a title, found once and remembered. A title with no match is retried after a week. */
export const resolveMedia = async (
  client: TrackerClient,
  title: string,
  now: number = Date.now(),
): Promise<TrackerMedia | null> => {
  const key = `${client.id}:${normalize(title)}`;
  const matches = mainStorage.getObject<Record<string, MediaMatch>>(MEDIA_KEY) || {};
  const known = matches[key];
  if (known && (known.media || now - known.at < MISS_TTL_MS)) {
    return known.media;
  }
  const media = await client.findMedia(title);
  matches[key] = {media, at: now};
  mainStorage.setObject(MEDIA_KEY, matches);
  return media;
};

export const getEnabledTrackers = (
  clients: TrackerClient[] = [createAniListClient(), createMalClient()],
): TrackerClient[] => clients.filter(client => client.isConnected() && isTrackerSyncEnabled(client.id));

export interface SyncOutcome {
  tracker: string;
  status: 'updated' | 'skipped' | 'not-found' | 'failed';
  error?: string;
}

/** Mark an episode as watched. Never lowers progress, so re-watching an old episode changes nothing. */
export const syncEpisodeWatched = async (
  input: {title: string; episode: number},
  clients: TrackerClient[] = getEnabledTrackers(),
  now: number = Date.now(),
): Promise<SyncOutcome[]> => {
  const outcomes: SyncOutcome[] = [];
  if (!(input.episode > 0) || !input.title.trim()) {
    return outcomes;
  }
  for (const client of clients) {
    try {
      const media = await resolveMedia(client, input.title, now);
      if (!media) {
        outcomes.push({tracker: client.name, status: 'not-found'});
        continue;
      }
      const progress = mainStorage.getObject<Record<string, number>>(PROGRESS_KEY) || {};
      const progressKey = `${client.id}:${media.id}`;
      if ((progress[progressKey] || 0) >= input.episode) {
        outcomes.push({tracker: client.name, status: 'skipped'});
        continue;
      }
      const finished = media.episodes !== undefined && input.episode >= media.episodes;
      await client.saveEntry(media.id, {
        progress: input.episode,
        status: finished ? 'completed' : 'watching',
      });
      progress[progressKey] = input.episode;
      mainStorage.setObject(PROGRESS_KEY, progress);
      outcomes.push({tracker: client.name, status: 'updated'});
    } catch (error: any) {
      outcomes.push({tracker: client.name, status: 'failed', error: String(error?.message || error)});
    }
  }
  return outcomes;
};

/** Send a library title's status and score. Neither is sent when the user has not set it. */
export const syncLibraryDetails = async (
  input: {title: string; status?: LibraryStatus; rating?: number},
  clients: TrackerClient[] = getEnabledTrackers(),
  now: number = Date.now(),
): Promise<SyncOutcome[]> => {
  const outcomes: SyncOutcome[] = [];
  if (!input.status && !input.rating) {
    return outcomes;
  }
  for (const client of clients) {
    try {
      const media = await resolveMedia(client, input.title, now);
      if (!media) {
        outcomes.push({tracker: client.name, status: 'not-found'});
        continue;
      }
      await client.saveEntry(media.id, {
        status: input.status ? LIBRARY_TO_TRACKER_STATUS[input.status] : undefined,
        score10: input.rating,
      });
      outcomes.push({tracker: client.name, status: 'updated'});
    } catch (error: any) {
      outcomes.push({tracker: client.name, status: 'failed', error: String(error?.message || error)});
    }
  }
  return outcomes;
};
