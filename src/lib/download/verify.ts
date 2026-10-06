import type {DownloadItem} from '../zustand/downloadsStore';

/**
 * A last check on a finished direct-file download. It only catches clear
 * problems, so a good file is never thrown away: an empty file, a file shorter
 * than the server said, or a tiny file where a video was expected (a link that
 * answered with an error page).
 */

const MIN_VIDEO_BYTES = 64 * 1024;
/** Shorter than the expected size by more than this is a cut-off file. */
const SIZE_SLACK_BYTES = 1024;
/** Sizes below this are too small to judge by. */
const MIN_JUDGED_EXPECTED_BYTES = 1024 * 1024;

export const verifyFinishedDownload = (
  record: Pick<DownloadItem, 'sourceType' | 'isSubtitle' | 'id'>,
  outputBytes: number,
  expectedBytes: number,
): string | undefined => {
  if (record.sourceType !== 'http' || record.isSubtitle || record.id.includes('_subtitle_')) {
    return undefined;
  }
  if (!(outputBytes > 0)) {
    return 'The downloaded file is empty';
  }
  if (
    expectedBytes >= MIN_JUDGED_EXPECTED_BYTES &&
    outputBytes < expectedBytes - SIZE_SLACK_BYTES
  ) {
    return `The file is incomplete: ${outputBytes} of ${expectedBytes} bytes`;
  }
  if (!(expectedBytes > 0) && outputBytes < MIN_VIDEO_BYTES) {
    return 'The file is too small to be a video. The link may have returned an error page';
  }
  return undefined;
};
