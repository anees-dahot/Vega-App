jest.mock('../src/lib/storage/StorageService', () => {
  const makeStorage = (map: Map<string, string>) => ({
    map,
    getString: (key: string) => map.get(key),
    setString: (key: string, value: string) => map.set(key, value),
    getObject: (key: string) => {
      const raw = map.get(key);
      return raw ? JSON.parse(raw) : undefined;
    },
    setObject: (key: string, value: unknown) =>
      map.set(key, JSON.stringify(value)),
    delete: (key: string) => map.delete(key),
  });
  return {
    mainStorage: makeStorage(new Map()),
    providerKvStorage: makeStorage(new Map()),
  };
});

import type {Stream} from '../src/lib/providers/types';
import {
  buildRuleFromSelection,
  isLegacyQuickDownloadSettingKey,
  normalizeServerName,
  orderServersByRule,
  serverRulesStorage,
  toRuleEntry,
  type ServerRule,
} from '../src/lib/download/serverRules';
import {
  pickDownloadServer,
  type ProbeResult,
} from '../src/lib/download/pickServer';

const {mainStorage, providerKvStorage} = jest.requireMock(
  '../src/lib/storage/StorageService',
);
const mockMain: Map<string, string> = mainStorage.map;
const mockKv: Map<string, string> = providerKvStorage.map;

const stream = (server: string, extra: Partial<Stream> = {}): Stream => ({
  server,
  link: `https://example.test/${encodeURIComponent(server)}`,
  type: 'mkv',
  ...extra,
});

const rule = (
  names: string[],
  onNoMatch: ServerRule['onNoMatch'] = 'auto',
): ServerRule => ({
  order: names.map(toRuleEntry),
  onNoMatch,
  updatedAt: 0,
});

const probeBy =
  (statuses: Record<string, ProbeResult['status']>) => async (s: Stream) => ({
    status: statuses[s.server] ?? 'ok',
  });

beforeEach(() => {
  mockMain.clear();
  mockKv.clear();
});

describe('normalizeServerName', () => {
  it('drops sizes, qualities, brackets and punctuation', () => {
    expect(normalizeServerName('CF Storage [2.1 GB]')).toBe('cf storage');
    expect(normalizeServerName('GDrive (700MB) 1080p')).toBe('gdrive');
    expect(normalizeServerName('Pixeldrain - 4K')).toBe('pixeldrain');
    expect(normalizeServerName(undefined)).toBe('');
  });
});

describe('orderServersByRule', () => {
  it('puts rule servers first in rule order and keeps the rest', () => {
    const servers = [
      stream('CF Worker [1GB]'),
      stream('Pixeldrain [1GB]'),
      stream('GDrive Instant [1GB]'),
    ];
    const {matched, rest} = orderServersByRule(
      servers,
      rule(['GDrive Instant', 'Pixeldrain']),
    );
    expect(matched.map(s => s.server)).toEqual([
      'GDrive Instant [1GB]',
      'Pixeldrain [1GB]',
    ]);
    expect(rest.map(s => s.server)).toEqual(['CF Worker [1GB]']);
  });

  it('matches whole words loosely but not partial words', () => {
    const servers = [stream('GDrive Instant'), stream('GDriveX')];
    const {matched} = orderServersByRule(servers, rule(['gdrive']));
    expect(matched.map(s => s.server)).toEqual(['GDrive Instant']);
  });
});

describe('buildRuleFromSelection', () => {
  it('makes the picked server primary and others fallbacks, skipping torrents', () => {
    const servers = [
      stream('CF Worker'),
      stream('Torrent', {type: 'torrent'}),
      stream('GDrive'),
    ];
    const built = buildRuleFromSelection(servers[2], servers);
    expect(built.order.map(e => e.key)).toEqual(['gdrive', 'cf worker']);
    expect(built.onNoMatch).toBe('auto');
  });
});

describe('pickDownloadServer', () => {
  const servers = [stream('CF Worker'), stream('Pixeldrain'), stream('GDrive')];

  it('uses the first rule server that answers', async () => {
    const result = await pickDownloadServer({
      servers,
      rule: rule(['GDrive', 'Pixeldrain']),
      probe: probeBy({GDrive: 'dead'}),
    });
    expect(result).toMatchObject({
      status: 'picked',
      via: 'rule',
      server: {server: 'Pixeldrain'},
      skipped: ['GDrive'],
    });
  });

  it('reports rule servers missing from this file', async () => {
    const result = await pickDownloadServer({
      servers,
      rule: rule(['HubCdn', 'GDrive']),
      probe: probeBy({}),
    });
    expect(result).toMatchObject({
      status: 'picked',
      server: {server: 'GDrive'},
      skipped: ['HubCdn'],
    });
  });

  it('falls back to best available when the rule says auto', async () => {
    const result = await pickDownloadServer({
      servers,
      rule: rule(['HubCdn']),
      probe: probeBy({'CF Worker': 'dead'}),
    });
    expect(result).toMatchObject({
      status: 'picked',
      via: 'auto',
      server: {server: 'Pixeldrain'},
    });
  });

  it('asks or skips when the rule says so', async () => {
    const dead = probeBy({GDrive: 'dead'});
    await expect(
      pickDownloadServer({servers, rule: rule(['GDrive'], 'ask'), probe: dead}),
    ).resolves.toMatchObject({status: 'ask'});
    await expect(
      pickDownloadServer({servers, rule: rule(['GDrive'], 'skip'), probe: dead}),
    ).resolves.toMatchObject({status: 'none'});
  });

  it('uses an unchecked rule server rather than giving up', async () => {
    const result = await pickDownloadServer({
      servers,
      rule: rule(['GDrive', 'Pixeldrain'], 'skip'),
      probe: probeBy({GDrive: 'unknown', Pixeldrain: 'dead'}),
    });
    expect(result).toMatchObject({status: 'picked', server: {server: 'GDrive'}});
  });

  it('never auto-picks torrents', async () => {
    const result = await pickDownloadServer({
      servers: [stream('Magnet', {type: 'torrent'})],
      rule: rule([]),
      probe: probeBy({}),
    });
    expect(result.status).toBe('none');
  });
});

describe('serverRulesStorage', () => {
  it('prefers the series rule over the provider rule', () => {
    serverRulesStorage.setProviderRule('vega', rule(['Pixeldrain']));
    expect(serverRulesStorage.resolve('vega', 'https://site/show')?.scope).toBe(
      'provider',
    );

    serverRulesStorage.setSeriesRule(
      'vega',
      'https://site/show',
      rule(['GDrive']),
      'Show',
    );
    const resolved = serverRulesStorage.resolve('vega', 'https://site/show');
    expect(resolved?.scope).toBe('series');
    expect(resolved?.rule.order[0].key).toBe('gdrive');
    expect(serverRulesStorage.resolve('vega', 'https://site/other')?.scope).toBe(
      'provider',
    );
  });

  it('carries over the old preferred server setting once', () => {
    mockKv.set(
      'vega:vega_preferredDownloadServer',
      JSON.stringify('pixeldrain'),
    );
    expect(serverRulesStorage.getProviderRule('vega')?.order).toEqual([
      {key: 'pixeldrain', label: 'pixeldrain'},
    ]);

    serverRulesStorage.clearProviderRule('vega');
    expect(serverRulesStorage.getProviderRule('vega')).toBeUndefined();
  });

  it('ignores the old setting when it is auto', () => {
    mockKv.set('vega:vega_preferredDownloadServer', JSON.stringify('auto'));
    expect(serverRulesStorage.resolve('vega', undefined)).toBeNull();
  });

  it('remembers known servers newest first without duplicates', () => {
    serverRulesStorage.recordKnownServers('vega', [stream('GDrive [1GB]')]);
    serverRulesStorage.recordKnownServers('vega', [
      stream('Pixeldrain'),
      stream('GDrive [2GB]'),
    ]);
    expect(serverRulesStorage.getKnownServers('vega').map(e => e.key)).toEqual([
      'pixeldrain',
      'gdrive',
    ]);
  });

  it('clears provider and series rules together', () => {
    serverRulesStorage.setProviderRule('vega', rule(['GDrive']));
    serverRulesStorage.setSeriesRule('vega', 'u1', rule(['GDrive']));
    serverRulesStorage.setSeriesRule('drive', 'u2', rule(['GDrive']));
    serverRulesStorage.clearAllForProvider('vega');
    expect(serverRulesStorage.resolve('vega', 'u1')).toBeNull();
    expect(serverRulesStorage.listSeriesRules('drive')).toHaveLength(1);
  });
});

describe('isLegacyQuickDownloadSettingKey', () => {
  it('matches the provider settings this feature replaces', () => {
    expect(isLegacyQuickDownloadSettingKey('vega_quickDownload')).toBe(true);
    expect(isLegacyQuickDownloadSettingKey('vega_preferredDownloadServer')).toBe(
      true,
    );
    expect(isLegacyQuickDownloadSettingKey('vega_skipTimings')).toBe(false);
  });
});
