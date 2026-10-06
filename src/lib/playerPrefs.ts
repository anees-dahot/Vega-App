import {mainStorage} from './storage/StorageService';

/**
 * Player choices that are remembered for one show: the audio and subtitle
 * language picked last. A show without a saved choice uses the app-wide one.
 */

export interface ShowTrackPrefs {
  /** Audio language. */
  audio?: string;
  /** Subtitle language or title. An empty string means subtitles off. */
  text?: string;
  updatedAt: number;
}

export const PLAYER_PREFS_KEY = 'playerShowTrackPrefs';
const STORAGE_KEY = PLAYER_PREFS_KEY;
const MAX_SHOWS = 200;

type PrefsMap = Record<string, ShowTrackPrefs>;

const readAll = (): PrefsMap => mainStorage.getObject<PrefsMap>(STORAGE_KEY) || {};

export const getShowTrackPrefs = (
  showKey: string | undefined,
): ShowTrackPrefs | undefined => (showKey ? readAll()[showKey] : undefined);

export const setShowTrackPref = (
  showKey: string | undefined,
  kind: 'audio' | 'text',
  value: string,
): void => {
  if (!showKey) {
    return;
  }
  const all = readAll();
  all[showKey] = {...all[showKey], [kind]: value, updatedAt: Date.now()};
  const keys = Object.keys(all);
  if (keys.length > MAX_SHOWS) {
    // Drop the shows not touched for the longest time.
    keys
      .sort((a, b) => all[a].updatedAt - all[b].updatedAt)
      .slice(0, keys.length - MAX_SHOWS)
      .forEach(key => delete all[key]);
  }
  mainStorage.setObject(STORAGE_KEY, all);
};

export type SleepTimerChoice =
  | {kind: 'off'}
  | {kind: 'minutes'; minutes: number}
  | {kind: 'episode'};

export const SLEEP_TIMER_OPTIONS: Array<{label: string; value: SleepTimerChoice}> = [
  {label: 'Off', value: {kind: 'off'}},
  {label: '15 minutes', value: {kind: 'minutes', minutes: 15}},
  {label: '30 minutes', value: {kind: 'minutes', minutes: 30}},
  {label: '45 minutes', value: {kind: 'minutes', minutes: 45}},
  {label: '1 hour', value: {kind: 'minutes', minutes: 60}},
  {label: 'End of this episode', value: {kind: 'episode'}},
];

export const isSameSleepChoice = (
  left: SleepTimerChoice,
  right: SleepTimerChoice,
): boolean =>
  left.kind === right.kind &&
  (left.kind !== 'minutes' ||
    (right.kind === 'minutes' && left.minutes === right.minutes));

/** Minutes left, rounded up, for showing next to the timer. */
export const formatSleepRemaining = (endsAt: number, now: number): string => {
  const minutes = Math.max(Math.ceil((endsAt - now) / 60000), 0);
  return minutes <= 1 ? 'less than a minute' : `${minutes} min`;
};

/** 83 seconds as "1:23", 3725 as "1:02:05". */
export const formatClock = (totalSeconds: number): string => {
  const seconds = Math.max(Math.floor(totalSeconds), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

/** A section of the video that repeats, between two points in seconds. */
export type RepeatSection = {start: number | null; end: number | null};

export const isRepeatSectionReady = (section: RepeatSection): section is {start: number; end: number} =>
  section.start !== null && section.end !== null && section.end > section.start;

/** Seconds of the countdown before the next episode starts by itself. */
export const AUTOPLAY_COUNTDOWN_SECONDS = 5;
