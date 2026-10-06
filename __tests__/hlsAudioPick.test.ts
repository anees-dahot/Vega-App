import {pickAudioPlaylist} from '../src/lib/hlsDownloader2';

const lines = (text: string) => text.trim().split('\n').map(l => l.trim());
const BASE = 'https://cdn.test/master.m3u8';

describe('pickAudioPlaylist', () => {
  it('takes the audio rendition that matches the wanted language', () => {
    const master = lines(`
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="aud/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Hindi",LANGUAGE="hi",URI="aud/hi.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO="a"
v1080.m3u8
`);
    expect(pickAudioPlaylist(master, BASE, {label: 'Hindi', language: 'hin'})?.url).toBe(
      'https://cdn.test/aud/hi.m3u8',
    );
    // Nothing matches: the stream's default sound.
    expect(pickAudioPlaylist(master, BASE, {label: 'Tamil', language: 'tam'})?.url).toBe(
      'https://cdn.test/aud/en.m3u8',
    );
  });

  it('takes the lightest stream when the sound is muxed into the video', () => {
    const master = lines(`
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
v1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
v720.m3u8
`);
    expect(pickAudioPlaylist(master, BASE)).toEqual({
      url: 'https://cdn.test/v360.m3u8',
      bandwidth: 800000,
    });
  });

  it('returns null when there is nothing to take', () => {
    expect(pickAudioPlaylist(lines('#EXTM3U'), BASE)).toBeNull();
  });
});
