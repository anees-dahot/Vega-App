import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {
  KeyboardAvoidingView,
  ToastAndroid,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import {
  LIBRARY_STATUSES,
  clampRating,
} from '../../lib/library/libraryMeta';
import type {
  LibraryStatus,
  WatchListItem,
} from '../../lib/storage/WatchListStorage';
import useWatchListStore from '../../lib/zustand/watchListStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import {TVFocusable, TVFocusGuide} from '../tv';
import {syncAiringReminders} from '../../lib/library/airingReminders';
import {syncLibraryDetails} from '../../lib/trackers/sync';

/**
 * Edit where the user is with a title: status, rating and a note. With more
 * than one title selected, only the status can be set.
 */
const LibraryItemSheet = ({
  visible,
  items,
  onClose,
}: {
  visible: boolean;
  items: WatchListItem[];
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  const updateItemMeta = useWatchListStore(state => state.updateItemMeta);
  const single = items.length === 1 ? items[0] : undefined;
  const [status, setStatus] = useState<LibraryStatus | undefined>();
  const [rating, setRating] = useState<number | undefined>();
  const [note, setNote] = useState('');
  const [remind, setRemind] = useState(false);

  useEffect(() => {
    if (visible) {
      setStatus(single?.status);
      setRating(single?.rating);
      setNote(single?.note ?? '');
      setRemind(Boolean(single?.remind));
    }
  }, [visible, single?.link]);

  if (!visible || items.length === 0) {
    return null;
  }

  const save = () => {
    const links = items.map(item => item.link);
    if (single) {
      updateItemMeta(links, {
        status,
        rating,
        note: note.trim() || undefined,
        remind: remind || undefined,
      });
      if (
        (status && status !== single.status) ||
        (rating && rating !== single.rating)
      ) {
        syncLibraryDetails({title: single.title, status, rating}).catch(
          () => undefined,
        );
      }
      if (remind !== Boolean(single.remind)) {
        // Set or remove the notification for this title's next episode.
        syncAiringReminders().catch(() => undefined);
      }
    } else if (status) {
      // Several titles: a status that was picked is applied to all of them.
      updateItemMeta(links, {status});
    }
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View
            className="max-h-[88%] rounded-t-3xl p-5"
            style={{backgroundColor: colors.surfaceContainer}}>
            <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>
              {single ? single.title : `${items.length} titles`}
            </AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
              {single ? 'Your status, score and note' : 'Set the status of all selected titles'}
            </AppText>

            <ScrollView
              focusable={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{gap: 10, paddingBottom: 6, paddingTop: 12}}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {LIBRARY_STATUSES.map(option => {
                  const selected = status === option.value;
                  return (
                    <TVFocusable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{selected}}
                      hasTVPreferredFocus={selected}
                      borderRadius={14}
                      focusScale={1}
                      // Tapping the chosen status again clears it.
                      onPress={() => setStatus(selected ? undefined : option.value)}
                      style={{
                        alignItems: 'center',
                        backgroundColor: selected ? colors.secondaryContainer : 'transparent',
                        borderColor: selected ? colors.primary : colors.outlineVariant,
                        borderRadius: 14,
                        borderWidth: 1,
                        flexDirection: 'row',
                        gap: 6,
                        paddingHorizontal: 12,
                        paddingVertical: 9,
                      }}>
                      <MaterialCommunityIcons
                        name={option.icon as never}
                        size={18}
                        color={selected ? colors.onSecondaryContainer : colors.primary}
                      />
                      <AppText
                        role="labelLarge"
                        style={{
                          color: selected ? colors.onSecondaryContainer : colors.onSurface,
                        }}>
                        {option.label}
                      </AppText>
                    </TVFocusable>
                  );
                })}
              </View>

              {single ? (
                <>
                  <View className="flex-row items-center" style={{gap: 10, marginTop: 6}}>
                    <MaterialCommunityIcons name="star" size={22} color={colors.primary} />
                    <AppText role="bodyLarge" style={{color: colors.onSurface, flex: 1}}>
                      {rating ? `${rating} / 10` : 'Not rated'}
                    </AppText>
                    <TVFocusable
                      accessibilityRole="button"
                      accessibilityLabel="Lower the rating"
                      borderRadius={12}
                      focusScale={1}
                      disabled={!rating}
                      onPress={() =>
                        setRating(value => (value && value > 1 ? clampRating(value - 1) : undefined))
                      }
                      style={{padding: 8, opacity: rating ? 1 : 0.35}}>
                      <MaterialCommunityIcons
                        name="minus-circle-outline"
                        size={26}
                        color={colors.onSurfaceVariant}
                      />
                    </TVFocusable>
                    <TVFocusable
                      accessibilityRole="button"
                      accessibilityLabel="Raise the rating"
                      borderRadius={12}
                      focusScale={1}
                      onPress={() => setRating(value => clampRating((value ?? 0) + 1))}
                      style={{padding: 8}}>
                      <MaterialCommunityIcons
                        name="plus-circle-outline"
                        size={26}
                        color={colors.onSurfaceVariant}
                      />
                    </TVFocusable>
                  </View>

                  <TVFocusable
                    accessibilityRole="switch"
                    accessibilityLabel="Remind me when new episodes air"
                    accessibilityState={{checked: remind}}
                    borderRadius={14}
                    focusScale={1}
                    onPress={() => {
                      const next = !remind;
                      setRemind(next);
                      if (next) {
                        // Needs permission to show notifications.
                        const {notificationService} =
                          require('../../lib/services/Notification') as typeof import('../../lib/services/Notification');
                        notificationService
                          .ensureDownloadPermission()
                          .then(granted => {
                            if (!granted) {
                              ToastAndroid.show(
                                'Allow notifications to get reminders',
                                ToastAndroid.LONG,
                              );
                            }
                          })
                          .catch(() => undefined);
                      }
                    }}
                    style={{
                      alignItems: 'center',
                      flexDirection: 'row',
                      gap: 10,
                      paddingVertical: 4,
                    }}>
                    <MaterialCommunityIcons
                      name={remind ? 'bell-ring' : 'bell-outline'}
                      size={22}
                      color={remind ? colors.primary : colors.onSurfaceVariant}
                    />
                    <View style={{flex: 1}}>
                      <AppText role="bodyLarge" style={{color: colors.onSurface}}>
                        Remind me when new episodes air
                      </AppText>
                      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                        A notification on the morning of the air date. Needs a TMDB key.
                      </AppText>
                    </View>
                    <MaterialCommunityIcons
                      name={remind ? 'toggle-switch' : 'toggle-switch-off-outline'}
                      size={34}
                      color={remind ? colors.primary : colors.onSurfaceVariant}
                    />
                  </TVFocusable>

                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Add a note"
                    placeholderTextColor={colors.onSurfaceVariant}
                    multiline
                    maxLength={500}
                    accessibilityLabel="Note"
                    style={{
                      backgroundColor: colors.surfaceContainerHighest,
                      borderColor: colors.outlineVariant,
                      borderRadius: 14,
                      borderWidth: 1,
                      color: colors.onSurface,
                      fontSize: 15,
                      minHeight: 84,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      textAlignVertical: 'top',
                    }}
                  />
                </>
              ) : null}
            </ScrollView>

            <View className="mt-3 flex-row items-center" style={{gap: 8}}>
              <View style={{flex: 1}} />
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                borderRadius={16}
                focusScale={1}
                onPress={onClose}
                style={{paddingHorizontal: 16, paddingVertical: 12}}>
                <AppText role="labelLarge" style={{color: colors.onSurface}}>
                  Cancel
                </AppText>
              </TVFocusable>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Save"
                borderRadius={16}
                focusScale={1}
                onPress={save}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 16,
                  paddingHorizontal: 22,
                  paddingVertical: 12,
                }}>
                <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                  Save
                </AppText>
              </TVFocusable>
            </View>
          </View>
        </TVFocusGuide>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default LibraryItemSheet;
