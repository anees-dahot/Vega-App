import type {LibraryStatus} from '../storage/WatchListStorage';

export type TrackerId = 'anilist' | 'mal';

/** Every site the app can keep a sign-in for. Trakt works differently, so it is not a TrackerId. */
export type StoredTrackerId = TrackerId | 'trakt';

export type TrackerStatus = 'watching' | 'planned' | 'completed' | 'dropped' | 'paused';

export interface TrackerMedia {
  id: number;
  title: string;
  /** Total episodes, when the site knows. */
  episodes?: number;
}

export interface TrackerEntryUpdate {
  /** Episodes watched. */
  progress?: number;
  status?: TrackerStatus;
  /** Score from 1 to 10. */
  score10?: number;
}

export interface TrackerClient {
  id: TrackerId;
  name: string;
  isConnected(): boolean;
  findMedia(title: string): Promise<TrackerMedia | null>;
  saveEntry(mediaId: number, update: TrackerEntryUpdate): Promise<void>;
}

export type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}>;

export const LIBRARY_TO_TRACKER_STATUS: Record<LibraryStatus, TrackerStatus> = {
  planned: 'planned',
  watching: 'watching',
  finished: 'completed',
  dropped: 'dropped',
};
