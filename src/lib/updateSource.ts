import Constants from 'expo-constants';
import {settingsStorage} from './storage';

/** Where the app looks for updates: the releases of a GitHub repository. */

export const OFFICIAL_UPDATE_REPO = 'vega-org/vega-app';

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;

/** "owner/repo", also from a pasted GitHub address. Undefined when it is neither. */
export const normalizeRepo = (input: string): string | undefined => {
  const trimmed = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const repo = trimmed.split('/').slice(0, 2).join('/');
  return REPO_PATTERN.test(repo) ? repo : undefined;
};

/**
 * The chosen update source. A fork has none until one is set (in settings, or
 * built in as `updateRepo`), so it never offers the official app's updates.
 */
export const getUpdateRepo = (): string => {
  const saved = settingsStorage.getUpdateRepo();
  if (saved) {
    return saved;
  }
  const extra = Constants.expoConfig?.extra;
  const built = typeof extra?.updateRepo === 'string' ? normalizeRepo(extra.updateRepo) : undefined;
  if (built) {
    return built;
  }
  return extra?.isFork ? '' : OFFICIAL_UPDATE_REPO;
};

export const getLatestReleaseUrl = (repo: string): string =>
  `https://api.github.com/repos/${repo}/releases/latest`;

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

/** The APK to install: one for this device type, else a universal one, else any. */
export const pickApkAsset = <T extends ReleaseAsset>(
  assets: T[] | undefined,
  isTv: boolean,
): T | undefined => {
  const apks = (assets || []).filter(asset => asset.name?.toLowerCase().endsWith('.apk'));
  const keyword = isTv ? 'tv' : 'mobile';
  return (
    apks.find(asset => asset.name?.toLowerCase().includes(keyword)) ||
    apks.find(asset => asset.name?.toLowerCase().includes('universal')) ||
    apks[0]
  );
};

/** True when `remote` is a newer "major.minor.patch" than `local`. A leading "v" is ignored. */
export const isNewerVersion = (local: string, remote: string): boolean => {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split('.')
      .map(part => Number(part.replace(/\D.*$/, '')) || 0);
  const a = parse(local);
  const b = parse(remote);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i += 1) {
    const difference = (b[i] || 0) - (a[i] || 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
};
