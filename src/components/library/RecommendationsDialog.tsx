import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Modal, Pressable, View} from 'react-native';
import {getTmdbApiKey} from '../../lib/hooks/useTmdbStory';
import {loadRecommendations, type Recommendation} from '../../lib/library/recommendations';
import type {WatchListItem} from '../../lib/storage/WatchListStorage';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import {TVFocusable, TVFocusGuide} from '../tv';

/** Titles like the ones you loved, from TMDB. Tapping one searches your providers for it. */
const RecommendationsDialog = ({
  visible,
  library,
  onClose,
  onSearch,
}: {
  visible: boolean;
  library: WatchListItem[];
  onClose: () => void;
  onSearch: (title: string) => void;
}) => {
  const colors = useM3Colors();
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const apiKey = getTmdbApiKey();
    if (!apiKey) {
      setError('Add a TMDB API key in Settings → Preferences to get recommendations.');
      setItems([]);
      return;
    }
    setError(null);
    setItems(null);
    try {
      setItems(await loadRecommendations(library, {apiKey}));
    } catch {
      setError('Could not load recommendations. Check your connection.');
      setItems([]);
    }
  }, [library]);

  useEffect(() => {
    if (visible) {
      load().catch(() => undefined);
    }
  }, [visible, load]);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View className="rounded-t-3xl p-4" style={{backgroundColor: colors.surfaceContainer, maxHeight: '88%'}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              Recommended for you
            </AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
              Based on titles you rated 8 or higher, finished or are watching
            </AppText>

            {items === null ? (
              <View className="items-center" style={{paddingVertical: 36}}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : error ? (
              <AppText role="bodyMedium" style={{color: colors.error, paddingVertical: 20}}>
                {error}
              </AppText>
            ) : items.length === 0 ? (
              <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingVertical: 20}}>
                Nothing to suggest yet. Rate a few titles 8 or higher, or mark them finished, in your library.
              </AppText>
            ) : (
              <FlatList
                focusable={false}
                data={items}
                keyExtractor={item => `${item.mediaType}:${item.id}`}
                style={{marginTop: 8, flexGrow: 0}}
                renderItem={({item}) => (
                  <TVFocusable
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${item.title}. ${item.because}`}
                    borderRadius={14}
                    focusScale={1}
                    onPress={() => onSearch(item.title)}
                    style={{
                      alignItems: 'center',
                      backgroundColor: colors.surfaceContainerHigh,
                      borderRadius: 14,
                      flexDirection: 'row',
                      gap: 12,
                      marginBottom: 6,
                      padding: 8,
                    }}>
                    <View
                      style={{
                        backgroundColor: colors.surfaceContainerHighest,
                        borderRadius: 10,
                        height: 66,
                        overflow: 'hidden',
                        width: 46,
                      }}>
                      {item.poster ? (
                        <Image source={{uri: item.poster}} style={{height: '100%', width: '100%'}} resizeMode="cover" />
                      ) : null}
                    </View>
                    <View style={{flex: 1}}>
                      <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface}}>
                        {item.title}
                        {item.year ? ` (${item.year})` : ''}
                      </AppText>
                      <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
                        {item.because}
                      </AppText>
                    </View>
                    <MaterialCommunityIcons name="magnify" size={22} color={colors.primary} />
                  </TVFocusable>
                )}
              />
            )}

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
                marginTop: 10,
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

export default RecommendationsDialog;
