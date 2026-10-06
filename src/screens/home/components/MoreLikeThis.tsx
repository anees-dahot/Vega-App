import React, {useEffect, useState} from 'react';
import {FlatList, Image, View} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import AppText from '../../../components/ui/Text';
import {getTmdbApiKey} from '../../../lib/hooks/useTmdbStory';
import {loadSimilarTitles, type SimilarTitle} from '../../../lib/library/similar';
import {useM3Colors} from '../../../theme/M3PaletteContext';

/** Titles similar to this one. Tapping one searches all providers for it. */
const MoreLikeThis = ({
  title,
  tmdbId,
  imdbId,
  type,
  onSearch,
}: {
  title?: string;
  tmdbId?: number | string;
  imdbId?: string;
  type?: string;
  onSearch: (title: string) => void;
}) => {
  const colors = useM3Colors();
  const [items, setItems] = useState<SimilarTitle[]>([]);

  useEffect(() => {
    const apiKey = getTmdbApiKey();
    if (!apiKey || (!tmdbId && !imdbId)) {
      setItems([]);
      return;
    }
    let active = true;
    loadSimilarTitles({tmdbId, imdbId, type, title}, {apiKey})
      .then(result => active && setItems(result))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [imdbId, title, tmdbId, type]);

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={{gap: 10, marginTop: 24}}>
      <AppText role="titleMedium" style={{color: colors.onSurface}}>
        More like this
      </AppText>
      <FlatList
        horizontal
        data={items}
        keyExtractor={item => `${item.mediaType}:${item.id}`}
        showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{width: 12}} />}
        renderItem={({item}) => (
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={`Search for ${item.title}`}
            onPress={() => onSearch(item.title)}
            borderRadius={14}
            style={{width: 110}}>
            {item.poster ? (
              <Image
                source={{uri: item.poster}}
                resizeMode="cover"
                style={{
                  backgroundColor: colors.surfaceContainerHigh,
                  borderRadius: 12,
                  height: 160,
                  width: 110,
                }}
              />
            ) : (
              <View
                style={{
                  backgroundColor: colors.surfaceContainerHigh,
                  borderRadius: 12,
                  height: 160,
                  width: 110,
                }}
              />
            )}
            <AppText
              role="labelMedium"
              numberOfLines={2}
              style={{color: colors.onSurface, marginTop: 6}}>
              {item.title}
            </AppText>
            {item.year ? (
              <AppText role="labelSmall" style={{color: colors.onSurfaceVariant}}>
                {item.year}
              </AppText>
            ) : null}
          </TVFocusable>
        )}
      />
    </View>
  );
};

export default MoreLikeThis;
