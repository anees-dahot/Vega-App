import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Modal, Pressable, View} from 'react-native';
import {testProvider} from '../lib/services/providerDiagnostics';
import {
  checkAllProviders,
  checkProviderHealth,
  describeHealthAge,
  getHealthKey,
  getHealthResult,
  getHealthStatus,
  sortByHealth,
  summarizeHealth,
  type HealthProvider,
  type HealthResult,
  type HealthStatus,
} from '../lib/services/providerHealth';
import {settingsStorage} from '../lib/storage';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import SettingsSwitchRow from './ui/SettingsSwitchRow';
import {TVFocusable, TVFocusGuide} from './tv';

const STATUS_ICON: Record<HealthStatus, string> = {
  working: 'check-circle',
  unsteady: 'alert-circle-outline',
  down: 'close-circle',
  untested: 'help-circle-outline',
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  working: 'Working',
  unsteady: 'Failed once',
  down: 'Not working',
  untested: 'Not tested yet',
};

/** Which installed providers work, from their own test, with a weekly automatic check. */
const ProviderHealthDialog = ({
  visible,
  providers,
  onClose,
}: {
  visible: boolean;
  providers: HealthProvider[];
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  const [results, setResults] = useState<Record<string, HealthResult | undefined>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{done: number; total: number} | null>(null);
  const [auto, setAuto] = useState(settingsStorage.isProviderHealthAuto());

  const resultFor = (provider: HealthProvider) =>
    results[getHealthKey(provider)] ?? getHealthResult(provider);
  const refresh = useCallback(
    (provider: HealthProvider) =>
      setResults(previous => ({...previous, [getHealthKey(provider)]: getHealthResult(provider)})),
    [],
  );

  const sorted = useMemo(() => sortByHealth(providers), [providers, results, running]);
  const summary = summarizeHealth(providers);

  const testOne = async (provider: HealthProvider) => {
    setRunning(getHealthKey(provider));
    await checkProviderHealth(provider, value => testProvider(value));
    refresh(provider);
    setRunning(null);
  };

  const testAll = async () => {
    setRunning('all');
    setProgress({done: 0, total: providers.length});
    await checkAllProviders(
      providers,
      value => testProvider(value),
      (done, total, provider) => {
        setProgress({done, total});
        refresh(provider);
      },
    );
    providers.forEach(refresh);
    setProgress(null);
    setRunning(null);
  };

  if (!visible) {
    return null;
  }

  const statusColor = (status: HealthStatus) =>
    status === 'working' ? colors.primary : status === 'down' ? colors.error : colors.onSurfaceVariant;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View className="rounded-t-3xl p-4" style={{backgroundColor: colors.surfaceContainer, maxHeight: '90%'}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              Provider health
            </AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
              {summary.working} working · {summary.down} not working
              {summary.unsteady ? ` · ${summary.unsteady} failed once` : ''}
              {summary.untested ? ` · ${summary.untested} not tested` : ''}
            </AppText>

            <FlatList
              focusable={false}
              data={sorted}
              keyExtractor={provider => getHealthKey(provider)}
              style={{marginTop: 8, flexGrow: 0}}
              renderItem={({item}) => {
                const result = resultFor(item);
                const status = getHealthStatus(result);
                const busy = running === getHealthKey(item) || running === 'all';
                return (
                  <View
                    style={{
                      alignItems: 'center',
                      borderBottomColor: colors.outlineVariant,
                      borderBottomWidth: 0.5,
                      flexDirection: 'row',
                      gap: 10,
                      paddingVertical: 8,
                    }}>
                    <MaterialCommunityIcons
                      name={STATUS_ICON[status] as never}
                      size={22}
                      color={statusColor(status)}
                    />
                    <View style={{flex: 1}}>
                      <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface}}>
                        {item.display_name}
                      </AppText>
                      <AppText role="bodySmall" numberOfLines={2} style={{color: statusColor(status)}}>
                        {STATUS_LABEL[status]}
                        {result ? ` · ${describeHealthAge(result.testedAt, Date.now())}` : ''}
                        {result && !result.ok && result.failedStage ? ` · ${result.failedStage}` : ''}
                      </AppText>
                      {result && !result.ok && result.message ? (
                        <AppText role="labelSmall" numberOfLines={2} style={{color: colors.onSurfaceVariant}}>
                          {result.message}
                        </AppText>
                      ) : null}
                    </View>
                    {busy && running === getHealthKey(item) ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <TVFocusable
                        accessibilityRole="button"
                        accessibilityLabel={`Test ${item.display_name}`}
                        disabled={running !== null}
                        borderRadius={12}
                        focusScale={1}
                        onPress={() => {
                          testOne(item).catch(() => setRunning(null));
                        }}
                        style={{opacity: running !== null ? 0.4 : 1, padding: 8}}>
                        <MaterialCommunityIcons name="play-circle-outline" size={24} color={colors.primary} />
                      </TVFocusable>
                    )}
                  </View>
                );
              }}
            />

            <SettingsSwitchRow
              title="Test every week"
              description="Checks all installed providers when the app opens, at most once a week"
              value={auto}
              divider={false}
              onValueChange={next => {
                settingsStorage.setProviderHealthAuto(next);
                setAuto(next);
              }}
            />

            <View className="mt-2 flex-row items-center" style={{gap: 8}}>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Test all providers"
                disabled={running !== null || providers.length === 0}
                borderRadius={16}
                focusScale={1}
                onPress={() => {
                  testAll().catch(() => setRunning(null));
                }}
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.secondaryContainer,
                  borderRadius: 16,
                  flexDirection: 'row',
                  gap: 8,
                  opacity: running !== null ? 0.5 : 1,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                }}>
                {running === 'all' ? (
                  <ActivityIndicator color={colors.onSecondaryContainer} size="small" />
                ) : (
                  <MaterialCommunityIcons name="heart-pulse" size={20} color={colors.onSecondaryContainer} />
                )}
                <AppText role="labelLarge" style={{color: colors.onSecondaryContainer}}>
                  {progress ? `Testing ${progress.done + 1} of ${progress.total}` : 'Test all'}
                </AppText>
              </TVFocusable>
              <View style={{flex: 1}} />
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hasTVPreferredFocus
                borderRadius={16}
                focusScale={1}
                onPress={onClose}
                style={{backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 10}}>
                <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                  Close
                </AppText>
              </TVFocusable>
            </View>
          </View>
        </TVFocusGuide>
      </View>
    </Modal>
  );
};

export default ProviderHealthDialog;
