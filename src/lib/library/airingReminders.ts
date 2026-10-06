import {settingsStorage} from '../storage';
import {watchListStorage} from '../storage/WatchListStorage';
import {formatEpisodeCode, loadAiringEntries, type AiringEntry} from './airingCalendar';

/**
 * A notification on the morning an episode airs, for the library titles the
 * user asked to be reminded about.
 */

export const REMINDER_PREFIX = 'airingReminder:';
/** Hour of the morning (local time) the reminder shows. */
export const REMINDER_HOUR = 9;

export interface PlannedReminder {
  id: string;
  title: string;
  body: string;
  atMs: number;
}

const startOfReminderDay = (date: string, hour: number): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour, 0, 0, 0).getTime();
};

/** Reminders still ahead of `now` for titles in `remindLinks`. */
export const planReminders = (
  entries: AiringEntry[],
  remindLinks: ReadonlySet<string>,
  now: number,
  hour = REMINDER_HOUR,
): PlannedReminder[] => {
  const planned: PlannedReminder[] = [];
  for (const entry of entries) {
    if (!remindLinks.has(entry.link) || !entry.next) {
      continue;
    }
    const atMs = startOfReminderDay(entry.next.date, hour);
    if (atMs <= now) {
      continue;
    }
    const code = formatEpisodeCode(entry.next);
    planned.push({
      id: `${REMINDER_PREFIX}${entry.link}:${code}`,
      title: entry.title,
      body: entry.next.name ? `${code} airs today: ${entry.next.name}` : `${code} airs today`,
      atMs,
    });
  }
  return planned.sort((a, b) => a.atMs - b.atMs);
};

/** Ids that are scheduled but no longer wanted. */
export const staleReminderIds = (
  scheduledIds: string[],
  planned: PlannedReminder[],
): string[] => {
  const wanted = new Set(planned.map(reminder => reminder.id));
  return scheduledIds.filter(id => id.startsWith(REMINDER_PREFIX) && !wanted.has(id));
};

/**
 * Makes the scheduled reminders match the library: schedules new ones and
 * removes those for titles no longer followed. Returns how many are set.
 */
export const syncAiringReminders = async (now: number = Date.now()): Promise<number> => {
  // Loaded here: the notification service starts native work when imported.
  const {notificationService} =
    require('../services/Notification') as typeof import('../services/Notification');
  const scheduled = await notificationService.getScheduledReminderIds().catch(() => [] as string[]);

  const items = settingsStorage.isAiringRemindersEnabled()
    ? watchListStorage.getWatchList().filter(item => item.remind)
    : [];
  let planned: PlannedReminder[] = [];
  if (items.length > 0) {
    const {getTmdbApiKey} = require('../hooks/useTmdbStory') as typeof import('../hooks/useTmdbStory');
    const apiKey = getTmdbApiKey();
    if (apiKey) {
      const entries = await loadAiringEntries(items, {apiKey, now});
      planned = planReminders(entries, new Set(items.map(item => item.link)), now);
    }
  }

  for (const id of staleReminderIds(scheduled, planned)) {
    await notificationService.cancelReminder(id).catch(() => undefined);
  }
  for (const reminder of planned) {
    await notificationService
      .scheduleReminder(reminder.id, reminder.title, reminder.body, reminder.atMs)
      .catch(() => undefined);
  }
  return planned.length;
};
