import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, ScrollView, View} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import AppText from '../../../components/ui/Text';
import {
  findTitleOnProviders,
  getCachedAvailability,
  setCachedAvailability,
  type ProviderMatch,
} from '../../../lib/providers/crossProvider';
import {searchOnProvider} from '../../../lib/providers/crossProviderApp';
import useContentStore from '../../../lib/zustand/contentStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';

/**
 * Which of the installed providers have this title. Searching them all costs
 * a request each, so it runs when asked, and the answer is kept for a while.
 */
const OtherProviders = ({
  title,
  currentProvider,
  onOpen,
}: {
  title: string;
  currentProvider: string;
  onOpen: (match: ProviderMatch) => void;
}) => {
  const colors = useM3Colors();
  const installedProviders = useContentStore(state => state.installedProviders);
  const [matches, setMatches] = useState<ProviderMatch[] | null>(
    () => getCachedAvailability(title)?.filter(m => m.providerValue !== currentProvider) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const check = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    findTitleOnProviders({
      title,
      providers: installedProviders,
      search: searchOnProvider,
      signal: controller.signal,
    })
      .then(found => {
        if (controller.signal.aborted) {
          return;
        }
        setCachedAvailability(title, found);
        setMatches(found.filter(m => m.providerValue !== currentProvider));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
  }, [currentProvider, installedProviders, title]);

  if (!title || installedProviders.length < 2) {
    return null;
  }

  return (
    <View style={{gap: 8, marginBottom: 14}}>
      <View style={{alignItems: 'center', flexDirection: 'row', gap: 10}}>
        <AppText role="titleSmall" style={{color: colors.onSurface}}>
          Other providers
        </AppText>
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel="Check which other providers have this title"
            onPress={check}
            borderRadius={14}
            style={{
              alignItems: 'center',
              backgroundColor: colors.secondaryContainer,
              borderRadius: 14,
              flexDirection: 'row',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}>
            <MaterialCommunityIcons name="magnify" size={16} color={colors.onSecondaryContainer} />
            <AppText role="labelMedium" style={{color: colors.onSecondaryContainer}}>
              {matches ? 'Check again' : 'Check'}
            </AppText>
          </TVFocusable>
        )}
      </View>
      {matches && matches.length === 0 && !loading ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
          No other provider has it.
        </AppText>
      ) : null}
      {matches && matches.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
          {matches.map(match => (
            <TVFocusable
              key={match.providerValue}
              accessibilityRole="button"
              accessibilityLabel={`Open on ${match.providerName}`}
              onPress={() => onOpen(match)}
              borderRadius={14}
              style={{
                backgroundColor: colors.surfaceContainerHigh,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}>
              <AppText role="labelLarge" style={{color: colors.onSurface}}>
                {match.providerName}
              </AppText>
            </TVFocusable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
};

export default OtherProviders;
