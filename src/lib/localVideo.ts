import {ToastAndroid} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {takePersistableUriPermission} from './uriPermission';
import type {RootStackParamList} from '../App';

/** Playing a video file from the device in the app's player. */

export const LOCAL_VIDEO_MIME_TYPES = [
  'video/*',
  'video/mp4',
  'video/x-matroska',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/x-m4v',
];

export type PlayerParams = RootStackParamList['Player'];

export const isLocalVideoUrl = (url: string | null | undefined): boolean =>
  Boolean(url) && (url!.startsWith('content://') || url!.startsWith('file://'));

/** A readable title from a file name or a uri: no folder and no extension. */
export const getLocalVideoTitle = (nameOrUri: string | undefined): string => {
  if (!nameOrUri) {
    return 'Local video';
  }
  let name = nameOrUri;
  try {
    name = decodeURIComponent(nameOrUri);
  } catch {}
  name = name.split('?')[0].split('/').pop() || name;
  // A content uri ends with something like "primary:Movies/film.mkv".
  name = name.split(':').pop() || name;
  const title = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').trim();
  return title || 'Local video';
};

/** Route params that make the player play one file from the device. */
export const buildLocalPlayerParams = (
  uri: string,
  name?: string,
): PlayerParams => {
  const title = getLocalVideoTitle(name || uri);
  return {
    linkIndex: 0,
    episodeList: [{title, link: uri}],
    directUrl: uri,
    type: 'movie',
    primaryTitle: title,
    poster: {},
  };
};

export interface PickedLocalVideo {
  uri: string;
  name?: string;
}

/** Let the user choose a video file. Resolves to null when they cancel. */
export const pickLocalVideo = async (): Promise<PickedLocalVideo | null> => {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: LOCAL_VIDEO_MIME_TYPES,
      multiple: false,
      copyToCacheDirectory: false,
    });
    const asset = !result.canceled ? result.assets?.[0] : undefined;
    if (!asset?.uri) {
      return null;
    }
    // Keep read access after a restart, so "continue watching" can reopen it.
    await takePersistableUriPermission(asset.uri);
    return {uri: asset.uri, name: asset.name || undefined};
  } catch (error) {
    console.warn('Could not pick a local video:', error);
    ToastAndroid.show('Could not open the file picker', ToastAndroid.SHORT);
    return null;
  }
};
