import {settingsStorage} from '../storage';
import useContentStore from '../zustand/contentStore';
import {
  checkAllProviders,
  getLastHealthRunSeconds,
  isHealthCheckDue,
} from './providerHealth';

/** Tests every installed provider once a week, when the user has turned that on. */
export const runWeeklyProviderHealthCheck = async (): Promise<boolean> => {
  if (!settingsStorage.isProviderHealthAuto()) {
    return false;
  }
  if (!isHealthCheckDue(Date.now(), getLastHealthRunSeconds())) {
    return false;
  }
  const providers = useContentStore.getState().installedProviders || [];
  if (providers.length === 0) {
    return false;
  }
  // Loaded here: the diagnostics pull in the whole provider sandbox.
  const {testProvider} =
    require('./providerDiagnostics') as typeof import('./providerDiagnostics');
  await checkAllProviders(providers, value => testProvider(value));
  return true;
};
