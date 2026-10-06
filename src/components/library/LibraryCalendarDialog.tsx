import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Image, Modal, Pressable, ScrollView, View} from 'react-native';
import {
  buildCalendar,
  formatEpisodeCode,
  loadAiringEntries,
  toLocalDate,
  type CalendarSection,
} from '../../lib/library/airingCalendar';
import {getTmdbApiKey} from '../../lib/hooks/useTmdbStory';
import type {WatchListItem} from '../../lib/storage/WatchListStorage';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import {TVFocusable, TVFocusGuide} from '../tv';

/** When the next episodes of the shows in the library air. */
const LibraryCalendarDialog = ({
  visible,
  items,
  onClose,
  onOpenTitle,
}: {
  visible: boolean;
  items: WatchListItem[];
  onClose: () => void;
  onOpenTitle: (item: WatchListItem) => void;
}) => {
  const colors = useM3Colors();
  const [sections, setSections] = useState<CalendarSection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      const apiKey = getTmdbApiKey();
      if (!apiKey) {
        setError('Add a TMDB API key in Settings → Preferences to see air dates.');
        setSections([]);
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const entries = await loadAiringEntries(items, {apiKey, force});
        setSections(buildCalendar(entries, toLocalDate(new Date())));
      } catch {
        setError('Could not load air dates. Check your connection and try again.');
        setSections([]);
      } finally {
        setLoading(false);
      }
    },
    [items],
  );

  useEffect(() => {
    if (visible) {
      setSections(null);
      load(false).catch(() => undefined);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View
            className="rounded-t-3xl p-5"
            style={{backgroundColor: colors.surfaceContainer, maxHeight: '85%'}}>
            <View className="flex-row items-center">
              <View style={{flex: 1}}>
                <AppText role="titleMedium" style={{color: colors.onSurface}}>
                  Airing calendar
                </AppText>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                  Shows in your library, from TMDB
                </AppText>
              </View>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Refresh air dates"
                borderRadius={14}
                focusScale={1}
                disabled={loading}
                onPress={() => {
                  load(true).catch(() => undefined);
                }}
                style={{padding: 10, opacity: loading ? 0.4 : 1}}>
                <MaterialCommunityIcons name="refresh" size={24} color={colors.primary} />
              </TVFocusable>
            </View>

            <ScrollView
              focusable={false}
              style={{marginTop: 8}}
              contentContainerStyle={{gap: 6, paddingBottom: 12}}>
              {loading || sections === null ? (
                <View className="items-center" style={{paddingVertical: 36}}>
                  <ActivityIndicator color={colors.primary} />
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 10}}>
                    Looking up air dates…
                  </AppText>
                </View>
              ) : error ? (
                <AppText role="bodyMedium" style={{color: colors.error, paddingVertical: 20}}>
                  {error}
                </AppText>
              ) : sections.length === 0 ? (
                <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingVertical: 20}}>
                  Nothing is airing soon for the shows in your library.
                </AppText>
              ) : (
                sections.map(section => (
                  <View key={section.title} style={{gap: 6}}>
                    <AppText
                      role="labelLarge"
                      style={{color: colors.primary, marginTop: 8}}>
                      {section.title}
                    </AppText>
                    {section.entries.map(entry => {
                      const libraryItem = items.find(item => item.link === entry.link);
                      return (
                        <TVFocusable
                          key={`${entry.link}-${entry.episode.date}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${entry.title}, ${formatEpisodeCode(entry.episode)}, ${entry.day}`}
                          borderRadius={14}
                          focusScale={1}
                          onPress={() => libraryItem && onOpenTitle(libraryItem)}
                          style={{
                            alignItems: 'center',
                            backgroundColor: colors.surfaceContainerHigh,
                            borderRadius: 14,
                            flexDirection: 'row',
                            gap: 12,
                            padding: 8,
                          }}>
                          <View
                            style={{
                              backgroundColor: colors.surfaceContainerHighest,
                              borderRadius: 10,
                              height: 56,
                              overflow: 'hidden',
                              width: 40,
                            }}>
                            {entry.poster ? (
                              <Image
                                source={{uri: entry.poster}}
                                style={{height: '100%', width: '100%'}}
                                resizeMode="cover"
                              />
                            ) : null}
                          </View>
                          <View style={{flex: 1}}>
                            <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface}}>
                              {entry.title}
                            </AppText>
                            <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
                              {formatEpisodeCode(entry.episode)}
                              {entry.episode.name ? ` · ${entry.episode.name}` : ''}
                            </AppText>
                          </View>
                          <AppText role="labelLarge" style={{color: colors.onSurface}}>
                            {entry.day}
                          </AppText>
                        </TVFocusable>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>

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

export default LibraryCalendarDialog;
