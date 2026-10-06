import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {Modal, Pressable, View} from 'react-native';
import {LIBRARY_SORTS, type LibrarySort} from '../../lib/library/libraryMeta';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import {TVFocusable, TVFocusGuide} from '../tv';

/** Choose how the library is ordered. */
const LibrarySortSheet = ({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: LibrarySort;
  onSelect: (sort: LibrarySort) => void;
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  if (!visible) {
    return null;
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View className="rounded-t-3xl p-5" style={{backgroundColor: colors.surfaceContainer}}>
            <AppText role="titleMedium" style={{color: colors.onSurface, marginBottom: 6}}>
              Sort by
            </AppText>
            {LIBRARY_SORTS.map(option => {
              const selected = option.value === value;
              return (
                <TVFocusable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{selected}}
                  accessibilityLabel={option.label}
                  hasTVPreferredFocus={selected}
                  borderRadius={14}
                  focusScale={1}
                  onPress={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                  style={{
                    alignItems: 'center',
                    flexDirection: 'row',
                    gap: 12,
                    minHeight: 48,
                    paddingHorizontal: 6,
                  }}>
                  <MaterialCommunityIcons
                    name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={selected ? colors.primary : colors.onSurfaceVariant}
                  />
                  <AppText role="bodyLarge" style={{color: colors.onSurface}}>
                    {option.label}
                  </AppText>
                </TVFocusable>
              );
            })}
          </View>
        </TVFocusGuide>
      </View>
    </Modal>
  );
};

export default LibrarySortSheet;
