import React from 'react';
import {Modal, Pressable, View} from 'react-native';
import {
  LIBRARY_STATUSES,
  type LibraryStats,
} from '../../lib/library/libraryMeta';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import {TVFocusable, TVFocusGuide} from '../tv';

const Row = ({label, value}: {label: string; value: string | number}) => {
  const colors = useM3Colors();
  return (
    <View className="flex-row items-center justify-between" style={{paddingVertical: 6}}>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>
        {label}
      </AppText>
      <AppText role="titleSmall" style={{color: colors.onSurface}}>
        {value}
      </AppText>
    </View>
  );
};

/** A short summary of the library: counts, ratings and notes. */
const LibraryStatsDialog = ({
  visible,
  stats,
  onClose,
}: {
  visible: boolean;
  stats: LibraryStats;
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  if (!visible) {
    return null;
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <Pressable style={{...absoluteFill}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View
            className="w-full rounded-3xl p-5"
            style={{backgroundColor: colors.surfaceContainer, maxWidth: 380}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              Library stats
            </AppText>
            <View style={{marginTop: 10}}>
              <Row label="Titles" value={stats.total} />
              {LIBRARY_STATUSES.map(status => (
                <Row key={status.value} label={status.label} value={stats.byStatus[status.value]} />
              ))}
              <Row label="No status" value={stats.byStatus.none} />
              <Row
                label="Rated"
                value={
                  stats.averageRating !== undefined
                    ? `${stats.rated} · average ${stats.averageRating}`
                    : stats.rated
                }
              />
              <Row label="With notes" value={stats.withNotes} />
              {stats.topProvider ? (
                <Row
                  label="Most used source"
                  value={`${stats.topProvider.name} (${stats.topProvider.count})`}
                />
              ) : null}
            </View>
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hasTVPreferredFocus
              borderRadius={16}
              focusScale={1}
              onPress={onClose}
              style={{
                alignSelf: 'flex-end',
                backgroundColor: colors.primary,
                borderRadius: 16,
                marginTop: 14,
                paddingHorizontal: 22,
                paddingVertical: 12,
              }}>
              <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                Close
              </AppText>
            </TVFocusable>
          </View>
        </TVFocusGuide>
      </View>
    </Modal>
  );
};

const absoluteFill = {bottom: 0, left: 0, position: 'absolute', right: 0, top: 0} as const;

export default LibraryStatsDialog;
