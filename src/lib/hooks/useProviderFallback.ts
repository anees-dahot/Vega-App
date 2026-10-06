import {useNavigation} from '@react-navigation/native';
import {useQueryClient} from '@tanstack/react-query';
import {useCallback, useRef} from 'react';
import {ToastAndroid} from 'react-native';
import {parseEpisodeNumber, parseSeasonNumber} from '../download/duplicates';
import {findAlternativeEpisode, type FoundAlternative} from '../providers/crossProviderApp';
import {settingsStorage} from '../storage';
import useContentStore from '../zustand/contentStore';
import {showAppDialog} from '../zustand/appDialogStore';
import {streamQueryKey} from './useStream';

interface PlayerParams {
  type: string;
  primaryTitle?: string;
  secondaryTitle?: string;
  providerValue?: string;
  [key: string]: unknown;
}

/**
 * When an episode cannot be played, look for the same one on the other
 * providers. Depending on the setting, the app asks first or switches by
 * itself when the title, season and episode number all match.
 */
export const useProviderFallback = ({
  params,
  activeEpisode,
  episodeIndex,
  currentProvider,
}: {
  params: PlayerParams;
  activeEpisode?: {id?: string; link?: string; title?: string};
  episodeIndex: number;
  currentProvider: string;
}) => {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const installedProviders = useContentStore(state => state.installedProviders);
  const triedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);

  const switchTo = useCallback(
    ({alternative, streams}: FoundAlternative) => {
      const episode = alternative.episodeList[alternative.linkIndex];
      queryClient.setQueryData(
        streamQueryKey(episode, params.type, alternative.providerValue),
        streams,
      );
      navigation.replace('Player', {
        ...params,
        providerValue: alternative.providerValue,
        infoUrl: alternative.infoUrl,
        secondaryTitle: alternative.seasonTitle,
        episodeList: alternative.episodeList,
        linkIndex: alternative.linkIndex,
        directUrl: undefined,
        file: undefined,
      });
    },
    [navigation, params, queryClient],
  );

  /**
   * Looks for the episode elsewhere. Resolves true when it switched or put a
   * question to the user, false when nothing was found or nothing was tried.
   * `manual` ignores the setting and the "already tried" memory.
   */
  const attempt = useCallback(
    (manual = false): Promise<boolean> => {
      const mode = settingsStorage.getProviderSwitchMode();
      const title = params.primaryTitle;
      const key = activeEpisode?.id || activeEpisode?.link || activeEpisode?.title || '';
      if (!title || (!manual && mode === 'off') || runningRef.current) {
        return Promise.resolve(false);
      }
      if (!manual && triedRef.current.has(key)) {
        return Promise.resolve(false);
      }
      triedRef.current.add(key);
      runningRef.current = true;
      ToastAndroid.show('Looking for this on other providers…', ToastAndroid.SHORT);
      const titleNumber = parseEpisodeNumber(activeEpisode?.title);
      // Promise chain instead of try/finally: React Compiler skips any
      // function that contains a finally clause.
      return findAlternativeEpisode({
        title,
        type: params.type,
        season: parseSeasonNumber(params.secondaryTitle),
        episodeNumber: titleNumber ?? (episodeIndex >= 0 ? episodeIndex + 1 : undefined),
        excludeValue: params.providerValue || currentProvider,
        providers: installedProviders,
      })
        .then(found => {
          if (!found) {
            return false;
          }
          const sure = found.alternative.certain && titleNumber !== undefined;
          if (mode === 'auto' && !manual && sure) {
            ToastAndroid.show(
              `Playing from ${found.alternative.providerName}`,
              ToastAndroid.SHORT,
            );
            switchTo(found);
            return true;
          }
          const episode = found.alternative.episodeList[found.alternative.linkIndex];
          showAppDialog({
            title: `Play from ${found.alternative.providerName}?`,
            message: `${found.alternative.providerName} has "${episode?.title || title}". Switch to it?`,
            actions: [
              {label: 'Cancel', onPress: () => navigation.goBack()},
              {label: 'Switch', onPress: () => switchTo(found)},
            ],
          });
          return true;
        })
        .catch(() => false)
        .finally(() => {
          runningRef.current = false;
        });
    },
    [
      activeEpisode?.id,
      activeEpisode?.link,
      activeEpisode?.title,
      currentProvider,
      episodeIndex,
      installedProviders,
      navigation,
      params,
      switchTo,
    ],
  );

  return {attempt};
};
