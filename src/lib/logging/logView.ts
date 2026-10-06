/** Reading the app log (one line per entry: "MM-dd HH:mm:ss.SSS L/Tag: message") for showing on screen. */

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E';

export interface LogEntry {
  time: string;
  level: LogLevel;
  tag: string;
  /** The message, with any following lines (such as a stack trace). */
  message: string;
}

const LINE = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) ([VDIWE])\/([^:]*): (.*)$/;

const ORDER: Record<LogLevel, number> = {V: 0, D: 1, I: 2, W: 3, E: 4};

export const parseLog = (text: string): LogEntry[] => {
  const entries: LogEntry[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(LINE);
    if (match) {
      entries.push({
        time: match[1],
        level: match[2] as LogLevel,
        tag: match[3],
        message: match[4],
      });
    } else if (line && entries.length > 0) {
      // A line without a header continues the entry before it. A partial first
      // line (the log was cut) has nothing before it and is dropped.
      entries[entries.length - 1].message += `\n${line}`;
    }
  }
  return entries;
};

export type LogFilter = 'all' | 'warnings' | 'errors';

export const filterLog = (entries: LogEntry[], filter: LogFilter): LogEntry[] => {
  const minimum = filter === 'errors' ? ORDER.E : filter === 'warnings' ? ORDER.W : 0;
  return entries.filter(entry => ORDER[entry.level] >= minimum);
};

export const countByFilter = (entries: LogEntry[]): Record<LogFilter, number> => ({
  all: entries.length,
  warnings: filterLog(entries, 'warnings').length,
  errors: filterLog(entries, 'errors').length,
});

/** The entries as plain text again, newest last, to copy. */
export const formatLog = (entries: LogEntry[]): string =>
  entries.map(entry => `${entry.time} ${entry.level}/${entry.tag}: ${entry.message}`).join('\n');
