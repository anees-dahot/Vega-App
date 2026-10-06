import {
  checkAllProviders,
  checkProviderHealth,
  describeHealthAge,
  getHealthKey,
  getHealthResult,
  getHealthStatus,
  isHealthCheckDue,
  sortByHealth,
  summarizeHealth,
  type HealthProvider,
} from '../src/lib/services/providerHealth';

const provider = (value: string, author = 'main'): HealthProvider => ({
  value,
  display_name: value.toUpperCase(),
  source: {author},
});

class StageError extends Error {
  constructor(public stage: string, message: string) {
    super(message);
  }
}

describe('provider health checks', () => {
  it('records a pass', async () => {
    const result = await checkProviderHealth(provider('a'), async () => undefined);
    expect(result).toMatchObject({ok: true, failures: 0});
    expect(getHealthResult(provider('a'))).toEqual(result);
    expect(getHealthStatus(result)).toBe('working');
  });

  it('records the failing stage and message', async () => {
    const result = await checkProviderHealth(provider('b'), async () => {
      throw new StageError('streams', 'Provider returned no streams');
    });
    expect(result).toMatchObject({
      ok: false,
      failedStage: 'streams',
      message: 'Provider returned no streams',
      failures: 1,
    });
    expect(getHealthStatus(result)).toBe('unsteady');
  });

  it('calls a provider down after two failures in a row, and working again after a pass', async () => {
    const fail = async () => {
      throw new Error('site changed');
    };
    await checkProviderHealth(provider('c'), fail);
    const second = await checkProviderHealth(provider('c'), fail);
    expect(second.failures).toBe(2);
    expect(getHealthStatus(second)).toBe('down');

    const recovered = await checkProviderHealth(provider('c'), async () => undefined);
    expect(recovered.failures).toBe(0);
    expect(getHealthStatus(recovered)).toBe('working');
  });

  it('keeps providers from different sources apart', async () => {
    await checkProviderHealth(provider('d', 'one'), async () => undefined);
    expect(getHealthResult(provider('d', 'two'))).toBeUndefined();
    expect(getHealthKey(provider('d', 'one'))).toBe('one:d');
  });

  it('tests providers one at a time and reports progress', async () => {
    const order: string[] = [];
    const seen: number[] = [];
    await checkAllProviders(
      [provider('x1'), provider('x2'), provider('x3')],
      async value => {
        order.push(value);
      },
      done => seen.push(done),
    );
    expect(order).toEqual(['x1', 'x2', 'x3']);
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('health summaries', () => {
  it('counts statuses and puts the broken ones first', async () => {
    const providers = [provider('ok1'), provider('bad1'), provider('new1')];
    await checkProviderHealth(providers[0], async () => undefined);
    const fail = async () => {
      throw new Error('x');
    };
    await checkProviderHealth(providers[1], fail);
    await checkProviderHealth(providers[1], fail);

    expect(summarizeHealth(providers)).toEqual({total: 3, working: 1, unsteady: 0, down: 1, untested: 1});
    expect(sortByHealth(providers).map(p => p.value)).toEqual(['bad1', 'new1', 'ok1']);
  });

  it('writes the age of a result', () => {
    const now = 10 * 24 * 3600 * 1000;
    expect(describeHealthAge(now - 10_000, now)).toBe('just now');
    expect(describeHealthAge(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(describeHealthAge(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(describeHealthAge(now - 24 * 3600_000, now)).toBe('1 day ago');
    expect(describeHealthAge(now - 3 * 24 * 3600_000, now)).toBe('3 days ago');
  });

  it('is due when never run, or a week has passed', () => {
    const now = 100 * 24 * 3600 * 1000;
    expect(isHealthCheckDue(now, 0)).toBe(true);
    expect(isHealthCheckDue(now, (now - 3 * 24 * 3600 * 1000) / 1000)).toBe(false);
    expect(isHealthCheckDue(now, (now - 7 * 24 * 3600 * 1000) / 1000)).toBe(true);
  });
});
