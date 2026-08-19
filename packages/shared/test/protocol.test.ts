import { describe, expect, it } from 'vitest';
import { CTF_RESPAWN_MS, RESPAWN_MS, TRAINING_RESPAWN_MS } from '../src/constants';
import { DEFAULT_ROOM_MODE, ROOM_MODES, TEAM_BLUE, TEAM_NONE, TEAM_RED, WEAPON_GUN, WEAPON_SWORD, isCtf, isRoomMode, isTeam, meleeSelectable, otherTeam, respawnMsFor, teamName, weaponAllowed } from '../src/protocol';

describe('room mode', () => {
  it('knows its modes and the default', () => {
    expect(ROOM_MODES).toEqual(['match', 'training', 'ctf']);
    expect(isRoomMode('ctf')).toBe(true);
    expect(isCtf('ctf')).toBe(true);
    expect(isCtf('match')).toBe(false);
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
    expect(meleeSelectable('ctf', 'all')).toBe(false);
  });

  it('respawn delay per mode', () => {
    expect(respawnMsFor('match')).toBe(RESPAWN_MS);
    expect(respawnMsFor('training')).toBe(TRAINING_RESPAWN_MS);
    expect(respawnMsFor('ctf')).toBe(CTF_RESPAWN_MS);
    expect(CTF_RESPAWN_MS).toBe(5000);
  });

  it('teams: two of them, each the other\'s enemy', () => {
    expect(isTeam(TEAM_RED)).toBe(true);
    expect(isTeam(TEAM_BLUE)).toBe(true);
    expect(isTeam(TEAM_NONE)).toBe(false);
    expect(isTeam(3)).toBe(false);
    expect(otherTeam(TEAM_RED)).toBe(TEAM_BLUE);
    expect(otherTeam(TEAM_BLUE)).toBe(TEAM_RED);
    expect(teamName(TEAM_RED)).toBe('Red');
    expect(teamName(TEAM_BLUE)).toBe('Blue');
  });

  it('weapon rules are unchanged by the room mode', () => {
    expect(weaponAllowed('all', WEAPON_GUN)).toBe(true);
    expect(weaponAllowed('sword', WEAPON_GUN)).toBe(false);
    expect(weaponAllowed('gun', WEAPON_SWORD)).toBe(false);
  });
});
