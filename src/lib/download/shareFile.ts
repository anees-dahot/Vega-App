import {NativeModules, Platform, ToastAndroid} from 'react-native';
import {getDownloadMimeType, type DownloadLocationConfig} from '../downloadLocation';
import type {DownloadItem} from '../zustand/downloadsStore';

interface ShareModule {
  shareFile?: (uri: string, mimeType: string, title: string | null) => Promise<boolean>;
  openFolder?: (treeUri: string) => Promise<boolean>;
}

const nativeModule = (): ShareModule | undefined =>
  Platform.OS === 'android'
    ? (NativeModules.HttpDownloadModule as ShareModule | undefined)
    : undefined;

/** The address another app can read: a content address, or a file path as a file address. */
export const getShareableUri = (item: Pick<DownloadItem, 'filePath' | 'finalDocumentUri'>): string | undefined => {
  const path = item.finalDocumentUri || item.filePath;
  if (!path) {
    return undefined;
  }
  if (path.startsWith('content://') || path.startsWith('file://')) {
    return path;
  }
  return path.startsWith('/') ? `file://${path}` : undefined;
};

export const shareDownloadedFile = async (
  item: Pick<DownloadItem, 'filePath' | 'finalDocumentUri' | 'videoType' | 'episodeName' | 'title'>,
): Promise<boolean> => {
  const uri = getShareableUri(item);
  const module = nativeModule();
  if (!uri || typeof module?.shareFile !== 'function') {
    ToastAndroid.show('This file cannot be shared', ToastAndroid.SHORT);
    return false;
  }
  try {
    await module.shareFile(
      uri,
      getDownloadMimeType(item.videoType || 'mp4'),
      item.episodeName || item.title,
    );
    return true;
  } catch (error) {
    console.warn('Could not share the file:', error);
    ToastAndroid.show('Could not share this file', ToastAndroid.SHORT);
    return false;
  }
};

/** Opens the download folder in the file app. Only a picked folder (not app storage) can be opened. */
export const openDownloadFolder = async (
  location: DownloadLocationConfig | null | undefined,
): Promise<boolean> => {
  const module = nativeModule();
  if (location?.type !== 'saf' || typeof module?.openFolder !== 'function') {
    ToastAndroid.show('Choose a download folder first', ToastAndroid.SHORT);
    return false;
  }
  try {
    await module.openFolder(location.uri);
    return true;
  } catch (error) {
    console.warn('Could not open the folder:', error);
    ToastAndroid.show('No app could show this folder', ToastAndroid.SHORT);
    return false;
  }
};
