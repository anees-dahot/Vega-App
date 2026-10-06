import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Clipboard, FlatList, Modal, Pressable, ToastAndroid, View} from 'react-native';
import {
  countByFilter,
  filterLog,
  formatLog,
  parseLog,
  type LogEntry,
  type LogFilter,
} from '../lib/logging/logView';
import {clearLogs, readRecentLogs, shareLogs} from '../lib/logging/vegaLog';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {TVFocusable, TVFocusGuide} from './tv';

const FILTERS: Array<{value: LogFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'warnings', label: 'Warnings'},
  {value: 'errors', label: 'Errors'},
];

/** Recent app logs on screen, with copy, share and clear. */
const LogViewerDialog = ({visible, onClose}: {visible: boolean; onClose: () => void}) => {
  const colors = useM3Colors();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(parseLog(await readRecentLogs()));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setFilter('all');
      load().catch(() => undefined);
    }
  }, [visible, load]);

  const counts = useMemo(() => countByFilter(entries), [entries]);
  // Newest first, so the latest problem is at the top.
  const shown = useMemo(() => [...filterLog(entries, filter)].reverse(), [entries, filter]);

  if (!visible) {
    return null;
  }

  const levelColor = (level: LogEntry['level']) =>
    level === 'E' ? colors.error : level === 'W' ? colors.tertiary : colors.onSurfaceVariant;

  const button = (label: string, icon: string, onPress: () => void) => (
    <TVFocusable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      borderRadius={14}
      focusScale={1}
      onPress={onPress}
      style={{alignItems: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 8}}>
      <MaterialCommunityIcons name={icon as never} size={20} color={colors.primary} />
      <AppText role="labelLarge" style={{color: colors.primary}}>
        {label}
      </AppText>
    </TVFocusable>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View className="rounded-t-3xl p-4" style={{backgroundColor: colors.surfaceContainer, maxHeight: '88%'}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              App logs
            </AppText>
            <View className="flex-row flex-wrap" style={{gap: 8, marginTop: 8}}>
              {FILTERS.map(option => {
                const selected = option.value === filter;
                return (
                  <TVFocusable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{selected}}
                    borderRadius={14}
                    focusScale={1}
                    onPress={() => setFilter(option.value)}
                    style={{
                      backgroundColor: selected ? colors.secondaryContainer : 'transparent',
                      borderColor: selected ? colors.primary : colors.outlineVariant,
                      borderRadius: 14,
                      borderWidth: 1,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                    }}>
                    <AppText
                      role="labelMedium"
                      style={{color: selected ? colors.onSecondaryContainer : colors.onSurfaceVariant}}>
                      {option.label} {counts[option.value]}
                    </AppText>
                  </TVFocusable>
                );
              })}
            </View>

            {loading ? (
              <View className="items-center" style={{paddingVertical: 30}}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : shown.length === 0 ? (
              <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingVertical: 24}}>
                {entries.length === 0
                  ? 'No logs yet. Turn on detailed logging to record more.'
                  : 'Nothing at this level.'}
              </AppText>
            ) : (
              <FlatList
                focusable={false}
                data={shown}
                keyExtractor={(_entry, index) => String(index)}
                style={{marginTop: 8, flexGrow: 0}}
                initialNumToRender={30}
                renderItem={({item}) => (
                  <View style={{borderBottomColor: colors.outlineVariant, borderBottomWidth: 0.5, paddingVertical: 6}}>
                    <AppText role="labelSmall" style={{color: levelColor(item.level)}}>
                      {item.time} · {item.level} · {item.tag}
                    </AppText>
                    <AppText
                      role="bodySmall"
                      selectable
                      style={{color: colors.onSurface, fontFamily: 'monospace'}}>
                      {item.message}
                    </AppText>
                  </View>
                )}
              />
            )}

            <View className="flex-row flex-wrap items-center" style={{gap: 4, marginTop: 8}}>
              {button('Refresh', 'refresh', () => {
                load().catch(() => undefined);
              })}
              {button('Copy', 'content-copy', () => {
                Clipboard.setString(formatLog(filterLog(entries, filter)));
                ToastAndroid.show('Logs copied', ToastAndroid.SHORT);
              })}
              {button('Share', 'share-variant-outline', () => {
                shareLogs().catch(() => ToastAndroid.show('Could not share the logs', ToastAndroid.SHORT));
              })}
              {button('Clear', 'delete-outline', () => {
                clearLogs()
                  .then(() => load())
                  .catch(() => undefined);
              })}
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

export default LogViewerDialog;
