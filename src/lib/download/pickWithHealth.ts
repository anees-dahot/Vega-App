import type {Stream} from '../providers/types';
import {
  pickDownloadServer,
  type PickResult,
  type ProbeFn,
} from './pickServer';
import {recordServerOutcome, sortByHealth} from './serverHealth';
import {parseStreamQuality, type ServerRule} from './serverRules';

/**
 * pickDownloadServer for a provider: servers outside the rule are tried best
 * first, and links found dead count against their server's record.
 */
export const pickServerWithHealth = (options: {
  provider: string | undefined;
  servers: Stream[];
  rule: Pick<ServerRule, 'order' | 'onNoMatch'> &
    Partial<Pick<ServerRule, 'quality'>>;
  excludeKeys?: string[];
  probe?: ProbeFn;
  /** Try the lowest quality first: for audio only, where a smaller file is the same sound. */
  preferSmallest?: boolean;
}): Promise<PickResult> => {
  const {provider, preferSmallest, ...rest} = options;
  return pickDownloadServer({
    ...rest,
    rank: others => {
      const healthy = sortByHealth(provider, others, server => server.server);
      if (!preferSmallest) {
        return healthy;
      }
      const height = (server: Stream) =>
        parseStreamQuality(server.quality) ?? Number.MAX_SAFE_INTEGER;
      // Array sort is stable, so health still orders servers of the same quality.
      return [...healthy].sort((a, b) => height(a) - height(b));
    },
    onProbe: (server, result) => {
      if (result.status === 'dead') {
        recordServerOutcome(provider, server.server, {success: false});
      }
    },
  });
};
