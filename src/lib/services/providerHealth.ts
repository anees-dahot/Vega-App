import {mainStorage} from '../storage/StorageService';

/**
 * Whether each installed provider still works. A check runs the provider's
 * own test (catalog, posts, metadata, streams) and the result is kept, so a
 * provider whose site changed shows up before it is needed.
 */

export interface HealthProvider {
  value: string;
  display_name: string;
  source?: {author?: string};
}

export interface HealthResult {
  ok: boolean;
  /** When the check finished, in milliseconds since 1970. */
  testedAt: number;
  durationMs: number;
  /** Stage that failed: catalog, posts, metadata, episodes or streams. */
  failedStage?: string;
  message?: string;
  /** Failed checks in a row, 0 after a pass. */
  failures: number;
}

export type HealthStatus = 'working' | 'unsteady' | 'down' | 'untested';

const RESULTS_KEY = 'providerHealthResults';
const LAST_RUN_KEY = 'providerHealthLastRunAt';
export const HEALTH_CHECK_INTERVAL_DAYS = 7;
export const HEALTH_CHECK_TIMEOUT_MS = 90_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const getHealthKey = (provider: HealthProvider): string =>
  `${provider.source?.author || ''}:${provider.value}`;

const readResults = (): Record<string, HealthResult> =>
  mainStorage.getObject<Record<string, HealthResult>>(RESULTS_KEY) || {};

export const getHealthResult = (provider: HealthProvider): HealthResult | undefined =>
  readResults()[getHealthKey(provider)];

/** One failure may be a bad luck pick or a network blip; two in a row mean it is down. */
export const getHealthStatus = (result: HealthResult | undefined): HealthStatus => {
  if (!result) {
    return 'untested';
  }
  if (result.ok) {
    return 'working';
  }
  return result.failures >= 2 ? 'down' : 'unsteady';
};

export const describeHealthAge = (testedAt: number, now: number): string => {
  const minutes = Math.floor((now - testedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export interface HealthSummary {
  total: number;
  working: number;
  unsteady: number;
  down: number;
  untested: number;
}

export const summarizeHealth = (
  providers: HealthProvider[],
  results: Record<string, HealthResult> = readResults(),
): HealthSummary => {
  const summary: HealthSummary = {total: providers.length, working: 0, unsteady: 0, down: 0, untested: 0};
  for (const provider of providers) {
    summary[getHealthStatus(results[getHealthKey(provider)])] += 1;
  }
  return summary;
};

/** Providers in the order to show: down first, then unsteady, untested and working. */
export const sortByHealth = <T extends HealthProvider>(
  providers: T[],
  results: Record<string, HealthResult> = readResults(),
): T[] => {
  const rank: Record<HealthStatus, number> = {down: 0, unsteady: 1, untested: 2, working: 3};
  return [...providers].sort(
    (a, b) =>
      rank[getHealthStatus(results[getHealthKey(a)])] - rank[getHealthStatus(results[getHealthKey(b)])] ||
      a.display_name.localeCompare(b.display_name),
  );
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The check took too long')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export type ProviderTestFn = (providerValue: string) => Promise<unknown>;

/** Runs one provider's test and keeps the result. */
export const checkProviderHealth = async (
  provider: HealthProvider,
  test: ProviderTestFn,
  now: () => number = Date.now,
): Promise<HealthResult> => {
  const started = now();
  const previous = getHealthResult(provider);
  let result: HealthResult;
  try {
    await withTimeout(test(provider.value), HEALTH_CHECK_TIMEOUT_MS);
    result = {ok: true, testedAt: now(), durationMs: now() - started, failures: 0};
  } catch (error: any) {
    result = {
      ok: false,
      testedAt: now(),
      durationMs: now() - started,
      failedStage: typeof error?.stage === 'string' ? error.stage : undefined,
      message: String(error?.message || error || 'The test failed').slice(0, 300),
      failures: (previous && !previous.ok ? previous.failures : 0) + 1,
    };
  }
  const all = readResults();
  all[getHealthKey(provider)] = result;
  mainStorage.setObject(RESULTS_KEY, all);
  return result;
};

/** Tests providers one after another, so the sites are not hit all at once. */
export const checkAllProviders = async (
  providers: HealthProvider[],
  test: ProviderTestFn,
  onProgress?: (done: number, total: number, provider: HealthProvider) => void,
): Promise<void> => {
  let done = 0;
  for (const provider of providers) {
    onProgress?.(done, providers.length, provider);
    await checkProviderHealth(provider, test);
    done += 1;
  }
  mainStorage.setNumber(LAST_RUN_KEY, Math.floor(Date.now() / 1000));
  onProgress?.(done, providers.length, providers[providers.length - 1]);
};

export const isHealthCheckDue = (nowMs: number, lastRunSeconds: number): boolean =>
  lastRunSeconds <= 0 ||
  nowMs - lastRunSeconds * 1000 >= HEALTH_CHECK_INTERVAL_DAYS * DAY_MS;

export const getLastHealthRunSeconds = (): number => mainStorage.getNumber(LAST_RUN_KEY) || 0;
