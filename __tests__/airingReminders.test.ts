import {
  REMINDER_PREFIX,
  planReminders,
  staleReminderIds,
} from '../src/lib/library/airingReminders';

const entry = (link: string, date: string, extra: object = {}) => ({
  link,
  title: `Show ${link}`,
  next: {date, season: 2, episode: 5, name: 'The Episode', ...extra},
});

// Oct 5 2026, 08:00 local.
const NOW = new Date(2026, 9, 5, 8, 0).getTime();

describe('planReminders', () => {
  it('plans a morning reminder for followed titles with an episode ahead', () => {
    const planned = planReminders(
      [entry('a', '2026-10-08'), entry('b', '2026-10-06')],
      new Set(['a', 'b']),
      NOW,
    );
    expect(planned.map(p => p.id)).toEqual([
      `${REMINDER_PREFIX}b:S02E05`,
      `${REMINDER_PREFIX}a:S02E05`,
    ]);
    expect(planned[0]).toMatchObject({
      title: 'Show b',
      body: 'S02E05 airs today: The Episode',
      atMs: new Date(2026, 9, 6, 9, 0).getTime(),
    });
  });

  it('plans today only if the morning has not passed yet', () => {
    const early = planReminders([entry('a', '2026-10-05')], new Set(['a']), NOW);
    expect(early).toHaveLength(1);
    const late = planReminders(
      [entry('a', '2026-10-05')],
      new Set(['a']),
      new Date(2026, 9, 5, 12, 0).getTime(),
    );
    expect(late).toEqual([]);
  });

  it('skips titles that are not followed, past dates, and shows with no next episode', () => {
    const planned = planReminders(
      [entry('x', '2026-10-09'), entry('past', '2026-10-01'), {link: 'none', title: 'None'}],
      new Set(['past', 'none']),
      NOW,
    );
    expect(planned).toEqual([]);
  });

  it('words the reminder without an episode name', () => {
    const [reminder] = planReminders([entry('a', '2026-10-07', {name: undefined})], new Set(['a']), NOW);
    expect(reminder.body).toBe('S02E05 airs today');
  });
});

describe('staleReminderIds', () => {
  it('lists scheduled reminders that are no longer wanted, and leaves other notifications alone', () => {
    const planned = planReminders([entry('a', '2026-10-08')], new Set(['a']), NOW);
    expect(
      staleReminderIds(
        [`${REMINDER_PREFIX}a:S02E05`, `${REMINDER_PREFIX}old:S01E01`, 'someOtherId'],
        planned,
      ),
    ).toEqual([`${REMINDER_PREFIX}old:S01E01`]);
  });
});
