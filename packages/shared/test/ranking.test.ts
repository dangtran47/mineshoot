import { describe, expect, it } from 'vitest';
import { kdRatio, rankCtf, rankPlayers } from '../src/ranking';

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

  it('rankCtf puts captures first, then the usual kills/deaths/name', () => {
    const rows = [
      { id: 'a', name: 'A', kills: 9, deaths: 0, captures: 0 },
      { id: 'b', name: 'B', kills: 1, deaths: 5, captures: 2 },
      { id: 'c', name: 'C', kills: 3, deaths: 1, captures: 2 },
      { id: 'd', name: 'D', kills: 3, deaths: 1 },
    ];
    expect(rankCtf(rows).map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});
