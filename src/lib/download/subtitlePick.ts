import type {TextTracks} from '../providers/types';

/** Languages offered for subtitles that download with a video. */
export const SUBTITLE_LANGUAGES: Array<{code: string; label: string}> = [
  {code: 'en', label: 'English'},
  {code: 'hi', label: 'Hindi'},
  {code: 'es', label: 'Spanish'},
  {code: 'fr', label: 'French'},
  {code: 'de', label: 'German'},
  {code: 'pt', label: 'Portuguese'},
  {code: 'it', label: 'Italian'},
  {code: 'ru', label: 'Russian'},
  {code: 'ar', label: 'Arabic'},
  {code: 'tr', label: 'Turkish'},
  {code: 'id', label: 'Indonesian'},
  {code: 'ja', label: 'Japanese'},
  {code: 'ko', label: 'Korean'},
  {code: 'zh', label: 'Chinese'},
  {code: 'bn', label: 'Bengali'},
  {code: 'ur', label: 'Urdu'},
];

type Subtitle = TextTracks[number];

const matchesLanguage = (subtitle: Subtitle, code: string): boolean => {
  const language = String(subtitle.language || '').toLowerCase();
  const title = String(subtitle.title || '').toLowerCase();
  const label = SUBTITLE_LANGUAGES.find(item => item.code === code)?.label.toLowerCase();
  return (
    language === code ||
    language.startsWith(`${code}-`) ||
    language.startsWith(`${code}_`) ||
    (label !== undefined && (language === label || title.includes(label))) ||
    title === code
  );
};

/**
 * The subtitle to download with a video: one in the preferred language, or
 * the first the stream offers when none is.
 */
export const pickDownloadSubtitle = (
  subtitles: TextTracks | undefined,
  preferredLanguage: string,
): Subtitle | undefined => {
  const usable = (subtitles || []).filter(subtitle => Boolean(subtitle?.uri));
  if (usable.length === 0) {
    return undefined;
  }
  const code = preferredLanguage.trim().toLowerCase();
  return usable.find(subtitle => matchesLanguage(subtitle, code)) ?? usable[0];
};
