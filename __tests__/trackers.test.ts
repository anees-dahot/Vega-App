import {createAniListClient, fetchAniListUser} from '../src/lib/trackers/anilist';
import {createMalClient, refreshMalToken} from '../src/lib/trackers/mal';
import {pickBestMatch, titleSimilarity} from '../src/lib/trackers/match';
import {
  buildMalAuthUrl,
  completeOAuth,
  getRedirectUri,
  parseOAuthRedirect,
  startOAuth,
} from '../src/lib/trackers/oauth';
import {
  clearTrackerAuth,
  getPendingOAuth,
  getTrackerAuth,
  getTrackerUser,
  setTrackerAuth,
  setTrackerClientId,
} from '../src/lib/trackers/storage';
import {syncEpisodeWatched, syncLibraryDetails} from '../src/lib/trackers/sync';
import type {FetchLike, TrackerClient} from '../src/lib/trackers/types';

const reply = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('title matching', () => {
  it('scores equal titles 1 and unrelated titles low', () => {
    expect(titleSimilarity('Attack on Titan', 'attack on titan!')).toBe(1);
    expect(titleSimilarity('Attack on Titan', 'Cooking with Cats')).toBeLessThan(0.3);
    expect(titleSimilarity('', 'x')).toBe(0);
  });

  it('picks the closest by any of its names, and refuses a weak match', () => {
    const candidates = [
      {names: ['Shingeki no Kyojin', 'Attack on Titan']},
      {names: ['Something Else Entirely']},
    ];
    expect(pickBestMatch('Attack on Titan', candidates, c => c.names)).toBe(candidates[0]);
    expect(pickBestMatch('Totally Different', candidates, c => c.names)).toBeNull();
  });

  it('does not match another season of the same show', () => {
    const candidates = [{names: ['Show']}, {names: ['Show 2nd Season']}];
    expect(pickBestMatch('Show Season 2', candidates, c => c.names)).toBe(candidates[1]);
    expect(pickBestMatch('Show', candidates, c => c.names)).toBe(candidates[0]);
  });
});

describe('AniList', () => {
  beforeEach(() => {
    clearTrackerAuth('anilist');
    setTrackerAuth('anilist', {accessToken: 'tok'});
  });

  it('finds an anime and sends progress, status and score out of 100', async () => {
    const fetchImpl = jest.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('Page(')) {
        return reply({
          data: {
            Page: {
              media: [
                {id: 5, episodes: 12, title: {romaji: 'Dr. Stone', english: 'Dr. Stone'}, synonyms: []},
                {id: 9, episodes: 3, title: {romaji: 'Other', english: null}, synonyms: []},
              ],
            },
          },
        });
      }
      return reply({data: {SaveMediaListEntry: {id: 1}}});
    }) as unknown as FetchLike;
    const client = createAniListClient(fetchImpl);

    expect(client.isConnected()).toBe(true);
    await expect(client.findMedia('Dr Stone')).resolves.toEqual({id: 5, title: 'Dr. Stone', episodes: 12});
    await client.saveEntry(5, {progress: 4, status: 'watching', score10: 8});

    const calls = (fetchImpl as unknown as jest.Mock).mock.calls;
    expect(calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[1][1].body).variables).toEqual({
      mediaId: 5,
      progress: 4,
      status: 'CURRENT',
      score: 80,
    });
  });

  it('reports errors from the site, and a missing sign-in', async () => {
    const failing = jest.fn(async () => reply({errors: [{message: 'Invalid token'}]}, 400)) as unknown as FetchLike;
    await expect(createAniListClient(failing).findMedia('x')).rejects.toThrow('Invalid token');
    clearTrackerAuth('anilist');
    await expect(createAniListClient(failing).findMedia('x')).rejects.toThrow('not connected');
  });

  it('reads the user name to check a token', async () => {
    const ok = (async () => reply({data: {Viewer: {name: 'sam'}}})) as unknown as FetchLike;
    await expect(fetchAniListUser('t', ok)).resolves.toBe('sam');
    const bad = (async () => reply({data: null}, 401)) as unknown as FetchLike;
    await expect(fetchAniListUser('t', bad)).rejects.toThrow('did not accept');
  });
});

describe('MyAnimeList', () => {
  beforeEach(() => {
    clearTrackerAuth('mal');
    setTrackerClientId('mal', 'client123');
    setTrackerAuth('mal', {accessToken: 'old', refreshToken: 'refresh', expiresAt: 9_999_999_999_999});
  });

  it('finds an anime and updates its list entry with a form body', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('/anime?q=')
        ? reply({data: [{node: {id: 7, title: 'Dr. Stone', num_episodes: 24, alternative_titles: {en: 'Dr. Stone', synonyms: []}}}]})
        : reply({status: 'watching'}),
    ) as unknown as FetchLike;
    const client = createMalClient(fetchImpl);

    await expect(client.findMedia('Dr Stone')).resolves.toEqual({id: 7, title: 'Dr. Stone', episodes: 24});
    await client.saveEntry(7, {progress: 3, status: 'planned', score10: 9});

    const put = (fetchImpl as unknown as jest.Mock).mock.calls[1];
    expect(put[0]).toBe('https://api.myanimelist.net/v2/anime/7/my_list_status');
    expect(put[1].method).toBe('PUT');
    expect(put[1].body).toBe('status=plan_to_watch&num_watched_episodes=3&score=9');
  });

  it('refreshes an expired token once and retries', async () => {
    let first = true;
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        return reply({access_token: 'new', refresh_token: 'refresh2', expires_in: 3600});
      }
      if (first) {
        first = false;
        return reply({}, 401);
      }
      return reply({data: []});
    }) as unknown as FetchLike;

    await createMalClient(fetchImpl).findMedia('Anything');

    expect(getTrackerAuth('mal')).toMatchObject({accessToken: 'new', refreshToken: 'refresh2'});
    const retry = (fetchImpl as unknown as jest.Mock).mock.calls.pop();
    expect(retry[1].headers.Authorization).toBe('Bearer new');
  });

  it('cannot refresh without a refresh token', async () => {
    clearTrackerAuth('mal');
    setTrackerAuth('mal', {accessToken: 'only'});
    await expect(refreshMalToken((async () => reply({})) as unknown as FetchLike)).resolves.toBe(false);
  });
});

describe('signing in', () => {
  beforeEach(() => {
    clearTrackerAuth('anilist');
    clearTrackerAuth('mal');
    setTrackerClientId('anilist', 'al-id');
    setTrackerClientId('mal', 'mal-id');
  });

  it('reads the address the site sends the user back to', () => {
    expect(parseOAuthRedirect('vegafork://oauth/anilist#access_token=abc&token_type=Bearer&expires_in=3600')).toEqual({
      tracker: 'anilist',
      params: {access_token: 'abc', token_type: 'Bearer', expires_in: '3600'},
    });
    expect(parseOAuthRedirect('vegafork://oauth/mal?code=c%20d&state=s1')).toEqual({
      tracker: 'mal',
      params: {code: 'c d', state: 's1'},
    });
    expect(parseOAuthRedirect('vegafork://library')).toBeNull();
    expect(parseOAuthRedirect('https://example.com/oauth/mal?code=x')).toBeNull();
  });

  it('builds the sign-in addresses', () => {
    expect(startOAuth('anilist', 'vegafork')).toBe(
      'https://anilist.co/api/v2/oauth/authorize?client_id=al-id&response_type=token',
    );
    const url = startOAuth('mal', 'vegafork');
    const pending = getPendingOAuth('mal')!;
    expect(url).toBe(buildMalAuthUrl('mal-id', pending.verifier, pending.state, 'vegafork://oauth/mal'));
    expect(pending.verifier).toHaveLength(64);
    expect(url).toContain('code_challenge_method=plain');
    expect(getRedirectUri('mal', 'vegafork')).toBe('vegafork://oauth/mal');
  });

  it('needs a client id first', () => {
    setTrackerClientId('mal', '');
    expect(() => startOAuth('mal', 'vegafork')).toThrow('client id');
  });

  it('finishes an AniList sign-in and remembers the user', async () => {
    const fetchImpl = (async () => reply({data: {Viewer: {name: 'sam'}}})) as unknown as FetchLike;
    const result = await completeOAuth(
      'vegafork://oauth/anilist#access_token=abc&expires_in=3600',
      'vegafork',
      fetchImpl,
      () => 1_000_000,
    );
    expect(result).toEqual({tracker: 'anilist', user: 'sam'});
    expect(getTrackerAuth('anilist')).toEqual({accessToken: 'abc', refreshToken: undefined, expiresAt: 1_000_000 + 3_600_000});
    expect(getTrackerUser('anilist')).toBe('sam');
  });

  it('finishes a MyAnimeList sign-in only when the state matches', async () => {
    startOAuth('mal', 'vegafork');
    const pending = getPendingOAuth('mal')!;
    const fetchImpl = jest.fn(async (url: string) =>
      url.includes('oauth2/token')
        ? reply({access_token: 'at', refresh_token: 'rt', expires_in: 100})
        : reply({name: 'mal-sam'}),
    ) as unknown as FetchLike;

    await expect(
      completeOAuth('vegafork://oauth/mal?code=cc&state=WRONG', 'vegafork', fetchImpl),
    ).rejects.toThrow('does not match');

    const result = await completeOAuth(
      `vegafork://oauth/mal?code=cc&state=${pending.state}`,
      'vegafork',
      fetchImpl,
    );
    expect(result).toEqual({tracker: 'mal', user: 'mal-sam'});
    const exchange = (fetchImpl as unknown as jest.Mock).mock.calls[0][1].body;
    expect(exchange).toContain(`code_verifier=${pending.verifier}`);
    expect(exchange).toContain('grant_type=authorization_code');
    expect(getPendingOAuth('mal')).toBeUndefined();
  });

  it('reports a refused sign-in, and ignores addresses that are not for it', async () => {
    await expect(
      completeOAuth('vegafork://oauth/anilist?error=access_denied&error_description=No', 'vegafork'),
    ).rejects.toThrow('No');
    await expect(completeOAuth('vegafork://downloads', 'vegafork')).resolves.toBeNull();
  });
});

describe('syncing', () => {
  const makeClient = (id: 'anilist' | 'mal', episodes?: number): TrackerClient & {saved: any[]; finds: number} => {
    const client = {
      id,
      name: id,
      saved: [] as any[],
      finds: 0,
      isConnected: () => true,
      async findMedia() {
        client.finds += 1;
        return {id: 11, title: 'Show', episodes};
      },
      async saveEntry(mediaId: number, update: any) {
        client.saved.push({mediaId, ...update});
      },
    };
    return client;
  };

  it('marks an episode watched, once per tracker, and only forward', async () => {
    const client = makeClient('anilist', 12);
    const t = Date.now();
    expect(await syncEpisodeWatched({title: 'Sync Show A', episode: 3}, [client], t)).toEqual([
      {tracker: 'anilist', status: 'updated'},
    ]);
    expect(client.saved).toEqual([{mediaId: 11, progress: 3, status: 'watching'}]);

    // The same or an earlier episode changes nothing.
    expect((await syncEpisodeWatched({title: 'Sync Show A', episode: 3}, [client], t))[0].status).toBe('skipped');
    expect((await syncEpisodeWatched({title: 'Sync Show A', episode: 2}, [client], t))[0].status).toBe('skipped');
    expect((await syncEpisodeWatched({title: 'Sync Show A', episode: 4}, [client], t))[0].status).toBe('updated');
    // The match is remembered, so the site is searched once.
    expect(client.finds).toBe(1);
  });

  it('completes the show on the last episode', async () => {
    const client = makeClient('mal', 12);
    await syncEpisodeWatched({title: 'Sync Show B', episode: 12}, [client]);
    expect(client.saved[0]).toMatchObject({progress: 12, status: 'completed'});
  });

  it('reports a title that is not found, and a tracker that fails, without stopping the rest', async () => {
    // Matches are remembered per tracker, so each needs its own id here.
    const missing: TrackerClient = {...makeClient('anilist'), id: 'one' as never, findMedia: async () => null};
    const broken: TrackerClient = {
      ...makeClient('mal'),
      id: 'two' as never,
      saveEntry: async () => {
        throw new Error('server down');
      },
    };
    const fine: TrackerClient = {...makeClient('anilist'), id: 'three' as never};
    const outcomes = await syncEpisodeWatched({title: 'Sync Show C', episode: 1}, [missing, broken, fine]);
    expect(outcomes.map(o => o.status)).toEqual(['not-found', 'failed', 'updated']);
    expect(outcomes[1].error).toBe('server down');
  });

  it('ignores a bad episode or an empty title', async () => {
    const client = makeClient('anilist');
    expect(await syncEpisodeWatched({title: 'X', episode: 0}, [client])).toEqual([]);
    expect(await syncEpisodeWatched({title: ' ', episode: 1}, [client])).toEqual([]);
    expect(client.finds).toBe(0);
  });

  it('sends a library status and score, but nothing when neither is set', async () => {
    const client = makeClient('mal');
    expect(await syncLibraryDetails({title: 'Sync Show D'}, [client])).toEqual([]);
    await syncLibraryDetails({title: 'Sync Show D', status: 'finished', rating: 9}, [client]);
    expect(client.saved).toEqual([{mediaId: 11, status: 'completed', score10: 9}]);
  });
});
