const mockSaved = {repo: ''};
const mockExtra: Record<string, unknown> = {};

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {getUpdateRepo: () => mockSaved.repo},
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {expoConfig: {get extra() { return mockExtra; }}},
}));

import {
  getLatestReleaseUrl,
  getUpdateRepo,
  isNewerVersion,
  normalizeRepo,
  pickApkAsset,
} from '../src/lib/updateSource';

describe('normalizeRepo', () => {
  it('accepts owner/repo and GitHub addresses', () => {
    expect(normalizeRepo('me/vega-fork')).toBe('me/vega-fork');
    expect(normalizeRepo(' https://github.com/me/vega-fork/ ')).toBe('me/vega-fork');
    expect(normalizeRepo('https://github.com/me/vega-fork.git')).toBe('me/vega-fork');
    expect(normalizeRepo('github.com/me/x')).toBe('me/x');
    expect(normalizeRepo('https://github.com/me/vega-fork/releases/latest')).toBe('me/vega-fork');
  });

  it('rejects anything else', () => {
    expect(normalizeRepo('')).toBeUndefined();
    expect(normalizeRepo('justaname')).toBeUndefined();
    expect(normalizeRepo('a b/c')).toBeUndefined();
    expect(normalizeRepo('../etc/passwd')).toBeUndefined();
  });
});

describe('getUpdateRepo', () => {
  beforeEach(() => {
    mockSaved.repo = '';
    Object.keys(mockExtra).forEach(key => delete mockExtra[key]);
  });

  it('uses the official repository for the normal app', () => {
    expect(getUpdateRepo()).toBe('vega-org/vega-app');
  });

  it('has no source for a fork until one is set', () => {
    mockExtra.isFork = true;
    expect(getUpdateRepo()).toBe('');
    mockExtra.updateRepo = 'me/fork';
    expect(getUpdateRepo()).toBe('me/fork');
    mockSaved.repo = 'other/fork';
    expect(getUpdateRepo()).toBe('other/fork');
  });

  it('builds the release address', () => {
    expect(getLatestReleaseUrl('me/fork')).toBe('https://api.github.com/repos/me/fork/releases/latest');
  });
});

describe('pickApkAsset', () => {
  const assets = [
    {name: 'notes.txt'},
    {name: 'vega-v5.apk'},
    {name: 'vega-universal.APK'},
    {name: 'vega-tv.apk'},
  ];

  it('prefers the file for the device type, then universal, then any APK', () => {
    expect(pickApkAsset(assets, true)?.name).toBe('vega-tv.apk');
    expect(pickApkAsset(assets, false)?.name).toBe('vega-universal.APK');
    expect(pickApkAsset([{name: 'vega-v5.apk'}], false)?.name).toBe('vega-v5.apk');
    expect(pickApkAsset([{name: 'notes.txt'}], false)).toBeUndefined();
    expect(pickApkAsset(undefined, false)).toBeUndefined();
  });
});

describe('isNewerVersion', () => {
  it('compares major, minor and patch numbers', () => {
    expect(isNewerVersion('5.0.2', 'v5.1.0')).toBe(true);
    expect(isNewerVersion('5.1.0', '5.1.0')).toBe(false);
    expect(isNewerVersion('5.1.0', '5.0.9')).toBe(false);
    expect(isNewerVersion('5.1.9', '5.2')).toBe(true);
    expect(isNewerVersion('5.9.0', '5.10.0')).toBe(true);
    expect(isNewerVersion('5.1.0', '5.1.0-beta')).toBe(false);
  });
});
