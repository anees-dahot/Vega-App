import {
  COMMUNITY_SKIP_TTL_MS,
  getCommunitySkips,
  pickMalId,
  toSkipIntervals,
} from '../src/lib/skips/communitySkips';

describe('pickMalId', () => {
  const results = [
    {mal_id: 1, title: 'Naruto Shippuden', title_english: 'Naruto Shippuden'},
    {mal_id: 20, title: 'Naruto', title_english: 'Naruto', titles: [{type: 'Japanese', title: 'ナルト'}]},
  ];

  it('uses only an exact title match, in any of the show\'s names', () => {
    expect(pickMalId(results, 'naruto')).toBe(20);
    expect(pickMalId(results, 'ナルト')).toBe(20);
    expect(pickMalId(results, 'Naruto: Shippuden')).toBe(1);
  });

  it('gives nothing when no title matches, so a non-anime show has no times', () => {
    expect(pickMalId(results, 'Breaking Bad')).toBeUndefined();
    expect(pickMalId([], 'x')).toBeUndefined();
    expect(pickMalId(results, '   ')).toBeUndefined();
  });
});

describe('toSkipIntervals', () => {
  it('turns AniSkip results into named intervals in order, dropping bad ones', () => {
    expect(
      toSkipIntervals({
        found: true,
        results: [
          {skipType: 'ed', interval: {startTime: 1300, endTime: 1390}},
          {skipType: 'op', interval: {startTime: 85.5, endTime: 175}},
          {skipType: 'recap', interval: {startTime: 10, endTime: 5}},
          {skipType: 'mixed-op', interval: {startTime: 'x', endTime: 9}},
        ],
      }),
    ).toEqual([
      {title: 'Intro', from: 85.5, to: 175},
      {title: 'Outro', from: 1300, to: 1390},
    ]);
    expect(toSkipIntervals({found: false})).toEqual([]);
    expect(toSkipIntervals(null)).toEqual([]);
  });
});

describe('getCommunitySkips', () => {
  const NOW = 3_000_000_000_000;
  const respond = (mal: unknown, skip: unknown) =>
    jest.fn(async (url: string) => (url.includes('jikan') ? mal : skip));

  const mal = {data: [{mal_id: 20, title: 'Naruto'}]};
  const skip = {found: true, results: [{skipType: 'op', interval: {startTime: 60, endTime: 150}}]};

  it('finds the show, then the episode times, and reuses both', async () => {
    const fetchJson = respond(mal, skip);
    const first = await getCommunitySkips({title: 'Naruto', episode: 3}, {now: NOW, fetchJson});
    expect(first).toEqual([{title: 'Intro', from: 60, to: 150}]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls[1][0]).toContain('/20/3?types=op&types=ed&types=recap');

    await getCommunitySkips({title: 'Naruto', episode: 3}, {now: NOW + 1000, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(2);

    // Another episode of the same show only needs the times.
    await getCommunitySkips({title: 'Naruto', episode: 4}, {now: NOW + 2000, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('asks again after the cache expires', async () => {
    const fetchJson = respond({data: [{mal_id: 21, title: 'Bleach'}]}, skip);
    await getCommunitySkips({title: 'Bleach', episode: 1}, {now: NOW, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await getCommunitySkips({title: 'Bleach', episode: 1}, {now: NOW + COMMUNITY_SKIP_TTL_MS + 1, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('gives nothing for a title with no match, without asking about episodes', async () => {
    const fetchJson = respond({data: [{mal_id: 5, title: 'Something Else'}]}, skip);
    expect(await getCommunitySkips({title: 'Some Western Show', episode: 1}, {now: NOW, fetchJson})).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('gives nothing for an empty title or a bad episode', async () => {
    const fetchJson = jest.fn();
    expect(await getCommunitySkips({title: ' ', episode: 1}, {fetchJson})).toEqual([]);
    expect(await getCommunitySkips({title: 'x', episode: 0}, {fetchJson})).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
