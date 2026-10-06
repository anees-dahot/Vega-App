import {NativeModules, Platform} from 'react-native';
import {settingsStorage} from '../storage';

/**
 * Rules for when downloads may run: Wi-Fi only, a daily time window, enough
 * free space, and how many connections one file uses. Wi-Fi only and the
 * connections are also applied by the native downloader.
 */

interface NativePolicyModule {
  setPolicy?: (wifiOnly: boolean, connectionsPerFile: number) => void;
  isUnmetered?: () => Promise<boolean>;
}

const nativeModule = NativeModules.HttpDownloadModule as
  | NativePolicyModule
  | undefined;

const BYTES_PER_MB = 1024 * 1024;

export type StartBlockReason = 'wifi' | 'schedule' | 'storage';

export type StartGate = {allowed: true} | {allowed: false; reason: StartBlockReason};

export const getStartBlockMessage = (reason: StartBlockReason): string => {
  switch (reason) {
    case 'wifi':
      return 'Waiting for Wi-Fi';
    case 'schedule':
      return 'Waiting for the download schedule';
    case 'storage':
      return 'Not enough free storage';
  }
};

/** Free space on the device in bytes, or undefined when it can't be read. */
export const getFreeStorageBytes = (): number | undefined => {
  try {
    // Loaded on use: the module does not load outside the app (tests).
    const {Paths} = require('expo-file-system') as typeof import('expo-file-system');
    const free = Paths.availableDiskSpace;
    return typeof free === 'number' && Number.isFinite(free) && free > 0
      ? free
      : undefined;
  } catch {
    return undefined;
  }
};

/** True when `minutes` (after midnight) is inside the window, which may wrap past midnight. */
export const isMinuteInWindow = (
  minutes: number,
  window: {start: number; end: number},
): boolean => {
  if (window.start === window.end) {
    return true;
  }
  return window.start < window.end
    ? minutes >= window.start && minutes < window.end
    : minutes >= window.start || minutes < window.end;
};

export const isWithinDownloadSchedule = (now: Date = new Date()): boolean => {
  if (!settingsStorage.isDownloadScheduleEnabled()) {
    return true;
  }
  return isMinuteInWindow(
    now.getHours() * 60 + now.getMinutes(),
    settingsStorage.getDownloadScheduleWindow(),
  );
};

export const formatMinutesOfDay = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

/** Send Wi-Fi only and the connection count to the native downloader. */
export const applyNativeDownloadPolicy = (): void => {
  if (Platform.OS !== 'android' || typeof nativeModule?.setPolicy !== 'function') {
    return;
  }
  nativeModule.setPolicy(
    settingsStorage.isDownloadWifiOnly(),
    settingsStorage.getDownloadConnections(),
  );
};

export const isUnmeteredConnection = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || typeof nativeModule?.isUnmetered !== 'function') {
    return true;
  }
  try {
    return await nativeModule.isUnmetered();
  } catch {
    return true;
  }
};

/**
 * Whether a queued download may start now. A download the user starts by hand
 * ignores this.
 */
export const getStartGate = async (): Promise<StartGate> => {
  if (!isWithinDownloadSchedule()) {
    return {allowed: false, reason: 'schedule'};
  }
  if (settingsStorage.isDownloadWifiOnly() && !(await isUnmeteredConnection())) {
    return {allowed: false, reason: 'wifi'};
  }
  const minFree = settingsStorage.getDownloadMinFreeMb() * BYTES_PER_MB;
  if (minFree > 0) {
    let free = getFreeStorageBytes();
    if (free !== undefined && free < minFree) {
      if (settingsStorage.isDownloadAutoCleanWatched()) {
        const {deleteWatchedDownloads} =
          require('./storageCleanup') as typeof import('./storageCleanup');
        await deleteWatchedDownloads().catch(() => undefined);
        free = getFreeStorageBytes();
      }
      if (free !== undefined && free < minFree) {
        return {allowed: false, reason: 'storage'};
      }
    }
  }
  return {allowed: true};
};
