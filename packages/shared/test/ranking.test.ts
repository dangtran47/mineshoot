import { describe, expect, it } from 'vitest';
import { kdRatio, rankPlayers } from '../src/ranking';

describe('rankPlayers', () => {
  it('sorts by kills desc, deaths asc, name asc', () => {
    const r = rankPlayers([
      { id: '1', name: 'zed', kills: 3, deaths: 2 },
      { id: '2', name: 'amy', kills: 3, deaths: 2 },
      { id: '3', name: 'bob', kills: 5, deaths: 9 },
      { id: '4', name: 'cat', kills: 3, deaths: 0 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['3', '4', '2', '1']);
  });
  it('handles empty', () => {
    expect(rankPlayers([])).toEqual([]);
  });
  it('kdRatio avoids divide by zero', () => {
    expect(kdRatio(4, 0)).toBe(4);
    expect(kdRatio(4, 2)).toBe(2);
  });
});
