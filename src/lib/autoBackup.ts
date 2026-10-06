import * as FileSystem from 'expo-file-system/legacy';
import {createBackup, parseBackup, restoreBackup} from './backup';
import {getSafEntryName} from './downloadLocation';
import {settingsStorage} from './storage';

/** Backups made on their own into a folder the user picked, newest few kept. */

export const AUTO_BACKUP_PREFIX = 'vega-auto-backup-';
export const AUTO_BACKUPS_KEPT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A little early is fine, so a daily backup does not slip a day. */
const DUE_TOLERANCE_MS = 60 * 60 * 1000;

export const isAutoBackupDue = (
  nowMs: number,
  lastAtSeconds: number,
  intervalDays: number,
): boolean =>
  lastAtSeconds <= 0 ||
  nowMs - lastAtSeconds * 1000 >= intervalDays * DAY_MS - DUE_TOLERANCE_MS;

export const getAutoBackupFileName = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${AUTO_BACKUP_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

export const isAutoBackupName = (name: string): boolean =>
  name.startsWith(AUTO_BACKUP_PREFIX);

/** Newest first. The name carries the date and time, so names sort by age. */
export const sortAutoBackupsNewestFirst = <T extends {name: string}>(files: T[]): T[] =>
  files.filter(file => isAutoBackupName(file.name)).sort((a, b) => b.name.localeCompare(a.name));

/** The backups beyond the newest `keep`. */
export const selectBackupsToDelete = <T extends {name: string}>(
  files: T[],
  keep = AUTO_BACKUPS_KEPT,
): T[] => sortAutoBackupsNewestFirst(files).slice(keep);

export interface AutoBackupFile {
  uri: string;
  name: string;
}

export const listAutoBackups = async (folderUri: string): Promise<AutoBackupFile[]> => {
  const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
  return sortAutoBackupsNewestFirst(uris.map(uri => ({uri, name: getSafEntryName(uri)})));
};

export type AutoBackupResult = 'done' | 'skipped' | 'failed';

/**
 * Writes a backup into the chosen folder when one is due (or `force`), and
 * removes the oldest ones. Never throws: a failed backup is only reported.
 */
export const runAutoBackup = async (
  options: {force?: boolean; now?: Date} = {},
): Promise<AutoBackupResult> => {
  const folder = settingsStorage.getAutoBackupFolder();
  if (!folder || (!options.force && !settingsStorage.isAutoBackupEnabled())) {
    return 'skipped';
  }
  const now = options.now ?? new Date();
  if (
    !options.force &&
    !isAutoBackupDue(
      now.getTime(),
      settingsStorage.getAutoBackupLastAt(),
      settingsStorage.getAutoBackupIntervalDays(),
    )
  ) {
    return 'skipped';
  }
  try {
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      folder,
      getAutoBackupFileName(now),
      'application/json',
    );
    await FileSystem.StorageAccessFramework.writeAsStringAsync(
      fileUri,
      JSON.stringify(createBackup(), null, 2),
    );
    settingsStorage.setAutoBackupLastAt(now.getTime() / 1000);
    // Old backups are removed after the new one is safely written.
    const files = await listAutoBackups(folder).catch(() => []);
    for (const file of selectBackupsToDelete(files)) {
      await FileSystem.StorageAccessFramework.deleteAsync(file.uri).catch(() => undefined);
    }
    return 'done';
  } catch (error) {
    console.warn('Automatic backup failed:', error);
    return 'failed';
  }
};

/** Restores the newest backup in the folder. Returns its name, or undefined when there is none. */
export const restoreLatestAutoBackup = async (): Promise<string | undefined> => {
  const folder = settingsStorage.getAutoBackupFolder();
  if (!folder) {
    return undefined;
  }
  const [latest] = await listAutoBackups(folder);
  if (!latest) {
    return undefined;
  }
  const text = await FileSystem.StorageAccessFramework.readAsStringAsync(latest.uri);
  restoreBackup(parseBackup(text));
  return latest.name;
};
