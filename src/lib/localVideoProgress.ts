import * as FileSystem from 'expo-file-system/legacy';
import {NativeModules} from 'react-native';
import {mainStorage} from './storage/StorageService';

/**
 * Where you stopped in a video from the device. The link of a picked file can
 * change every time (the system picker hands out temporary links), so the place
 * is remembered by the file's size instead.
 */

const KEY = 'localVideoProgress';
const MAX_ENTRIES = 200;

export interface LocalVideoProgress {
  position: number;
  duration: number;
  updatedAt: number;
}

type SizeModule = {getUriSize?: (uri: string) => Promise<number>};

/** "local:<bytes>" for a file on the device, or undefined when its size can't be read. */
export const getLocalVideoIdentity = async (
  uri: string,
): Promise<string | undefined> => {
  try {
    const native = (NativeModules.HttpDownloadModule ||
      NativeModules.SafCopyModule) as SizeModule | undefined;
    let size = await native?.getUriSize?.(uri);
    if (!(typeof size === 'number' && size > 0)) {
      const info = await FileSystem.getInfoAsync(uri);
      size = info.exists && 'size' in info ? info.size : undefined;
    }
    return typeof size === 'number' && size > 0 ? `local:${size}` : undefined;
  } catch {
    return undefined;
  }
};

const readAll = (): Record<string, LocalVideoProgress> =>
  mainStorage.getObject<Record<string, LocalVideoProgress>>(KEY) || {};

export const getLocalVideoProgress = (
  identity: string,
): LocalVideoProgress | undefined => readAll()[identity];

export const saveLocalVideoProgress = (
  identity: string,
  position: number,
  duration: number,
  now: number = Date.now(),
): void => {
  if (!Number.isFinite(position) || position < 0 || !(duration > 0)) {
    return;
  }
  const all = readAll();
  all[identity] = {position, duration, updatedAt: now};
  const entries = Object.entries(all);
  if (entries.length > MAX_ENTRIES) {
    entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    mainStorage.setObject(KEY, Object.fromEntries(entries.slice(0, MAX_ENTRIES)));
    return;
  }
  mainStorage.setObject(KEY, all);
};
