jest.mock('../src/lib/services/ProviderManager', () => ({providerManager: {getStream: jest.fn()}}));
jest.mock('../src/lib/download/pickWithHealth', () => ({pickServerWithHealth: jest.fn()}));
import {providerManager} from '../src/lib/services/ProviderManager';
import {pickServerWithHealth} from '../src/lib/download/pickWithHealth';
import {resolveStreamForRecord} from '../src/lib/download/resolveDownload';
import {serverRulesStorage} from '../src/lib/download/serverRules';

describe('resolving an audio download', () => {
  it('ignores the quality and no-match rules saved for the video', async () => {
    serverRulesStorage.setProviderRule('prov', {order: [], onNoMatch: 'skip', quality: '1080', updatedAt: 1} as any);
    (providerManager.getStream as jest.Mock).mockResolvedValue([{server: 'A', link: 'x', type: 'mkv'}]);
    (pickServerWithHealth as jest.Mock).mockResolvedValue({status: 'picked', server: {}, via: 'rule', skipped: []});
    const base: any = {id: 'a', provider: 'prov', sourceLink: 's', type: 'series'};
    await resolveStreamForRecord({...base, audioFor: 'v'});
    const rule = (pickServerWithHealth as jest.Mock).mock.calls[0][0].rule;
    expect(rule.quality).toBeUndefined();
    await resolveStreamForRecord({...base});
    expect((pickServerWithHealth as jest.Mock).mock.calls[1][0].rule.quality).toBe('1080');
    expect(rule.onNoMatch).toBe('auto');
  });
});
