import axios from 'axios';
import {fetchIMDbSuggestions} from '../src/lib/services/imdbSuggestions';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('fetchIMDbSuggestions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array without a request if the query is under 2 characters', async () => {
    const result1 = await fetchIMDbSuggestions('');
    const result2 = await fetchIMDbSuggestions(' e ');
    expect(result1).toEqual([]);
    expect(result2).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('fetches and formats pure title suggestions from IMDb endpoint', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        d: [
          {
            id: 'tt0112159',
            l: 'Neon Genesis Evangelion',
            q: 'TV series',
            y: 1995,
            i: {
              imageUrl: 'https://example.com/poster.jpg',
            },
          },
          {
            id: 'tt0169858',
            l: 'Neon Genesis Evangelion: The End of Evangelion',
            q: 'movie',
            y: 1997,
          },
          // Duplicate title with different case
          {
            id: 'tt9999999',
            l: 'neon genesis evangelion',
            q: 'TV series',
          },
        ],
      },
    });

    const suggestions = await fetchIMDbSuggestions('evangion');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://v3.sg.media-imdb.com/suggestion/titles/e/evangion.json',
      expect.objectContaining({timeout: 5000}),
    );

    // The duplicate title with different case is left out.
    expect(suggestions).toEqual([
      {title: 'Neon Genesis Evangelion', type: 'tv', year: 1995},
      {
        title: 'Neon Genesis Evangelion: The End of Evangelion',
        type: 'movie',
        year: 1997,
      },
    ]);
  });

  it('handles non-alphanumeric first characters gracefully with x', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        d: [
          {
            id: 'tt1234567',
            l: 'The Hack',
            q: 'movie',
          },
        ],
      },
    });

    const suggestions = await fetchIMDbSuggestions('.hack');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://v3.sg.media-imdb.com/suggestion/titles/x/.hack.json',
      expect.objectContaining({timeout: 5000}),
    );
    expect(suggestions).toEqual([
      {title: 'The Hack', type: 'movie', year: undefined},
    ]);
  });

  it('handles API errors gracefully and returns empty array', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    const suggestions = await fetchIMDbSuggestions('batman');
    expect(suggestions).toEqual([]);
  });
});
