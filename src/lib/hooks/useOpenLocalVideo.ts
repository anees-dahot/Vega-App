import {useNavigation} from '@react-navigation/native';
import {useCallback} from 'react';
import {buildLocalPlayerParams, pickLocalVideo} from '../localVideo';

/** Returns a function that picks a video file and plays it in the player. */
export const useOpenLocalVideo = () => {
  const navigation = useNavigation<any>();
  return useCallback(async () => {
    const picked = await pickLocalVideo();
    if (picked) {
      // The player is on the root stack; navigate bubbles up to it.
      navigation.navigate(
        'Player',
        buildLocalPlayerParams(picked.uri, picked.name),
      );
    }
  }, [navigation]);
};
