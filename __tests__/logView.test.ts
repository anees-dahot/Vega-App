import {countByFilter, filterLog, formatLog, parseLog} from '../src/lib/logging/logView';

const LOG = [
  'ial line cut off by the size limit',
  '10-05 12:00:00.100 I/VegaJS: app started',
  '10-05 12:00:01.200 W/VegaJS: slow provider',
  '10-05 12:00:02.300 E/VegaCrash: Uncaught exception on main',
  'java.lang.IllegalStateException: boom',
  '\tat com.vega.Foo.bar(Foo.kt:10)',
  '10-05 12:00:03.400 D/Tag: detail',
  '',
].join('\n');

describe('parseLog', () => {
  it('reads entries, drops a cut first line and keeps stack traces with their entry', () => {
    const entries = parseLog(LOG);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({time: '10-05 12:00:00.100', level: 'I', tag: 'VegaJS', message: 'app started'});
    expect(entries[2].message).toBe(
      'Uncaught exception on main\njava.lang.IllegalStateException: boom\n\tat com.vega.Foo.bar(Foo.kt:10)',
    );
  });

  it('copes with empty text and Windows line ends', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('10-05 12:00:00.100 I/A: x\r\n10-05 12:00:01.100 E/B: y\r\n')).toHaveLength(2);
  });
});

describe('log filters', () => {
  const entries = parseLog(LOG);

  it('keeps warnings and errors, or only errors', () => {
    expect(filterLog(entries, 'all')).toHaveLength(4);
    expect(filterLog(entries, 'warnings').map(e => e.level)).toEqual(['W', 'E']);
    expect(filterLog(entries, 'errors').map(e => e.level)).toEqual(['E']);
  });

  it('counts each filter', () => {
    expect(countByFilter(entries)).toEqual({all: 4, warnings: 2, errors: 1});
  });

  it('writes entries back as text', () => {
    expect(formatLog(entries.slice(0, 2))).toBe(
      '10-05 12:00:00.100 I/VegaJS: app started\n10-05 12:00:01.200 W/VegaJS: slow provider',
    );
  });
});
