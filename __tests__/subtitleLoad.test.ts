const mockReadFile = jest.fn();
jest.mock('@dr.pogodin/react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import {loadSubtitleCues} from '../src/lib/subtitles/load';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHi\n';

describe('loadSubtitleCues', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('reads a subtitle from the web, once', async () => {
    const fetchMock = jest.fn(async () => ({ok: true, status: 200, text: async () => SRT}));
    global.fetch = fetchMock as never;
    const first = await loadSubtitleCues('https://s.example/a.srt');
    const second = await loadSubtitleCues('https://s.example/a.srt');
    expect(first).toEqual([{start: 1000, end: 2000, text: 'Hi'}]);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a file on the device', async () => {
    mockReadFile.mockResolvedValueOnce(SRT);
    await expect(loadSubtitleCues('file:///sdcard/a.srt')).resolves.toHaveLength(1);
    expect(mockReadFile).toHaveBeenCalledWith('/sdcard/a.srt', 'utf8');
  });

  it('fails clearly when the download fails, and gives nothing for an unsupported format', async () => {
    global.fetch = jest.fn(async () => ({ok: false, status: 404, text: async () => ''})) as never;
    await expect(loadSubtitleCues('https://s.example/missing.srt')).rejects.toThrow('404');

    mockReadFile.mockResolvedValueOnce('[Script Info]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi');
    await expect(loadSubtitleCues('file:///sdcard/a.ass')).resolves.toEqual([]);
  });
});
