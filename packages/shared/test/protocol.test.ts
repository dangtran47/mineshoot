import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_MODE, ROOM_MODES, WEAPON_GUN, WEAPON_SWORD, isRoomMode, meleeSelectable, weaponAllowed } from '../src/protocol';

describe('room mode', () => {
  it('knows its modes and the default', () => {
    expect(ROOM_MODES).toEqual(['match', 'training']);
    expect(DEFAULT_ROOM_MODE).toBe('match');
    expect(isRoomMode('training')).toBe(true);
    expect(isRoomMode('match')).toBe(true);
    expect(isRoomMode('lobby')).toBe(false);
    expect(isRoomMode(undefined)).toBe(false);
  });

  it('melee weapons can be picked directly only in training rooms where melee is allowed', () => {
    expect(meleeSelectable('training', 'all')).toBe(true);
    expect(meleeSelectable('training', 'sword')).toBe(true);
    expect(meleeSelectable('training', 'gun')).toBe(false);
    expect(meleeSelectable('match', 'all')).toBe(false);
    expect(meleeSelectable('match', 'sword')).toBe(false);
  });

  it('weapon rules are unchanged by the room mode', () => {
    expect(weaponAllowed('all', WEAPON_GUN)).toBe(true);
    expect(weaponAllowed('sword', WEAPON_GUN)).toBe(false);
    expect(weaponAllowed('gun', WEAPON_SWORD)).toBe(false);
  });
});
