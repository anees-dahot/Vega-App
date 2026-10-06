import {
  disconnectTrakt,
  findTraktTitle,
  pollDeviceLogin,
  refreshTraktToken,
  startDeviceLogin,
  syncTraktEpisode,
  syncTraktMovie,
} from '../src/lib/trackers/trakt';
import {
  getTrackerAuth,
  getTrackerUser,
  setTrackerAuth,
  setTrackerClientId,
  setTrackerClientSecret,
} from '../src/lib/trackers/storage';
import type {FetchLike} from '../src/lib/trackers/types';

const reply = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const search = (kind: 'show' | 'movie', id: number, title: string) => [
  {type: kind, [kind]: {title, year: 2020, ids: {trakt: id}}},
];

describe('Trakt sign-in', () => {
  beforeEach(() => {
    disconnectTrakt();
    setTrackerClientId('trakt', 'cid');
    setTrackerClientSecret('trakt', 'secret');
  });

  it('asks for a device code and reads how long it lasts', async () => {
    const fetchImpl = jest.fn(async () =>
      reply({device_code: 'dc', user_code: 'ABCD1234', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5}),
    );
    const login = await startDeviceLogin(fetchImpl as unknown as FetchLike, () => 1000);
    expect(login).toMatchObject({deviceCode: 'dc', userCode: 'ABCD1234', expiresAt: 601000, interval: 5});
    expect(JSON.parse((fetchImpl.mock.calls[0] as any)[1].body)).toEqual({client_id: 'cid'});
  });

  it('needs the client id', async () => {
    setTrackerClientId('trakt', '');
    await expect(startDeviceLogin(jest.fn() as unknown as FetchLike)).rejects.toThrow('client ID');
  });

  it('waits while pending, and keeps the token and user once the code is entered', async () => {
    const login = {deviceCode: 'dc', userCode: 'X', verificationUrl: 'u', expiresAt: 10_000, interval: 5};
    const statuses: Record<number, unknown> = {400: {}, 429: {}, 418: {}, 410: {}};
    for (const [status, expected] of [[400, 'pending'], [429, 'slow'], [418, 'denied'], [410, 'expired']] as const) {
      const fetchImpl = jest.fn(async () => reply(statuses[status], status));
      expect((await pollDeviceLogin(login, fetchImpl as unknown as FetchLike, () => 0)).status).toBe(expected);
    }
    expect((await pollDeviceLogin(login, jest.fn() as unknown as FetchLike, () => 20_000)).status).toBe('expired');

    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/oauth/device/token')
        ? reply({access_token: 'at', refresh_token: 'rt', expires_in: 7200})
        : reply({user: {username: 'sam'}}),
    );
    const result = await pollDeviceLogin(login, fetchImpl as unknown as FetchLike, () => 0);
    expect(result).toEqual({status: 'ok', user: 'sam'});
    expect(getTrackerAuth('trakt')).toMatchObject({accessToken: 'at', refreshToken: 'rt'});
    expect(getTrackerUser('trakt')).toBe('sam');
  });

  it('refreshes a token', async () => {
    setTrackerAuth('trakt', {accessToken: 'old', refreshToken: 'rt'});
    const fetchImpl = jest.fn(async () => reply({access_token: 'new', refresh_token: 'rt2', expires_in: 100}));
    expect(await refreshTraktToken(fetchImpl as unknown as FetchLike, () => 0)).toBe(true);
    expect(getTrackerAuth('trakt')?.accessToken).toBe('new');
    expect(await refreshTraktToken(jest.fn(async () => reply({}, 400)) as unknown as FetchLike)).toBe(false);
  });
});

describe('Trakt history', () => {
  beforeEach(() => {
    disconnectTrakt();
    setTrackerClientId('trakt', 'cid');
    setTrackerAuth('trakt', {accessToken: 'tok'});
  });

  const calls = (fetchImpl: jest.Mock) =>
    fetchImpl.mock.calls.map(([url, init]: [string, any]) => ({url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined}));

  it('finds a show once and remembers it', async () => {
    const fetchImpl = jest.fn(async () => reply(search('show', 11, 'Slow Horses')));
    const first = await findTraktTitle('show', 'Slow Horses', fetchImpl as unknown as FetchLike);
    const second = await findTraktTitle('show', 'slow horses!', fetchImpl as unknown as FetchLike);
    expect(first).toEqual({trakt: 11, title: 'Slow Horses', year: 2020});
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('adds an episode to the history, once', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('/search/') ? reply(search('show', 22, 'Show Twenty')) : reply({added: {episodes: 1}}),
    );
    const f = fetchImpl as unknown as FetchLike;
    expect(await syncTraktEpisode({title: 'Show Twenty', season: 2, episode: 3}, f, () => 5)).toBe('sent');
    expect(await syncTraktEpisode({title: 'Show Twenty', season: 2, episode: 3}, f, () => 5)).toBe('skipped');
    const post = calls(fetchImpl).find(c => c.method === 'POST');
    expect(post?.url).toBe('https://api.trakt.tv/sync/history');
    expect(post?.body.shows[0]).toMatchObject({ids: {trakt: 22}, seasons: [{number: 2, episodes: [{number: 3}]}]});
  });

  it('sends nothing without a season, an episode or a match', async () => {
    const fetchImpl = jest.fn(async () => reply([]));
    const f = fetchImpl as unknown as FetchLike;
    expect(await syncTraktEpisode({title: 'X', episode: 1}, f)).toBe('skipped');
    expect(await syncTraktEpisode({title: 'X', season: 1}, f)).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await syncTraktEpisode({title: 'Nothing Like It', season: 1, episode: 1}, f)).toBe('not-found');
  });

  it('allows another try after a failed send', async () => {
    let fail = true;
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('/search/')) return reply(search('show', 33, 'Retry Show'));
      return fail ? reply({}, 500) : reply({added: {}});
    });
    const f = fetchImpl as unknown as FetchLike;
    await expect(syncTraktEpisode({title: 'Retry Show', season: 1, episode: 1}, f)).rejects.toThrow('500');
    fail = false;
    expect(await syncTraktEpisode({title: 'Retry Show', season: 1, episode: 1}, f)).toBe('sent');
  });

  it('adds a movie and does nothing when not signed in', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('/search/') ? reply(search('movie', 44, 'Some Movie')) : reply({}),
    );
    expect(await syncTraktMovie({title: 'Some Movie'}, fetchImpl as unknown as FetchLike)).toBe('sent');
    disconnectTrakt();
    expect(await syncTraktMovie({title: 'Other'}, fetchImpl as unknown as FetchLike)).toBe('off');
  });

  it('replaces an expired token and retries once', async () => {
    setTrackerClientSecret('trakt', 'secret');
    setTrackerAuth('trakt', {accessToken: 'stale', refreshToken: 'rt'});
    let searches = 0;
    const fetchImpl = jest.fn(async (url: string, init: any) => {
      if (url.endsWith('/oauth/token')) return reply({access_token: 'fresh', refresh_token: 'rt', expires_in: 9999999});
      if (url.includes('/search/')) {
        searches += 1;
        return init.headers.Authorization === 'Bearer stale' ? reply({}, 401) : reply(search('show', 55, 'Auth Show'));
      }
      return reply({});
    });
    const found = await findTraktTitle('show', 'Auth Show', fetchImpl as unknown as FetchLike, () => 0);
    expect(found?.trakt).toBe(55);
    expect(searches).toBe(2);
  });
});
