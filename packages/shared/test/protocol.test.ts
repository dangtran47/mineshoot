import { describe, expect, it } from 'vitest';
import { CTF_RESPAWN_MS, RESPAWN_MS, TRAINING_RESPAWN_MS } from '../src/constants';
import { DEFAULT_ROOM_MODE, GUN_SLOTS, ROOM_MODES, WEAPON_MODES, TEAM_BLUE, TEAM_NONE, TEAM_RED, WEAPONS, WEAPON_GRENADE, WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_MELEE, WEAPON_TASER, allowedWeapons, defaultWeapon, isCtf, isGunSlot, isWeapon, isRoomMode, isTd, isTeam, isTeamMode, meleeSelectable, otherTeam, respawnMsFor, teamName, weaponAllowed } from '../src/protocol';

describe('room mode', () => {
  it('knows its modes and the default', () => {
    expect(ROOM_MODES).toEqual(['match', 'training', 'ctf', 'td']);
    expect(isRoomMode('ctf')).toBe(true);
    expect(isCtf('ctf')).toBe(true);
    expect(isCtf('match')).toBe(false);
    expect(isTd('td')).toBe(true);
    expect(isTd('ctf')).toBe(false);
    expect(DEFAULT_ROOM_MODE).toBe('match');
    expect(isRoomMode('training')).toBe(true);
    expect(isRoomMode('match')).toBe(true);
    expect(isRoomMode('td')).toBe(true);
    expect(isRoomMode('lobby')).toBe(false);
    expect(isRoomMode(undefined)).toBe(false);
  });

  it('ctf and td are the team modes', () => {
    expect(isTeamMode('ctf')).toBe(true);
    expect(isTeamMode('td')).toBe(true);
    expect(isTeamMode('match')).toBe(false);
    expect(isTeamMode('training')).toBe(false);
  });

  it('melee weapons can be picked directly only in training rooms where melee is allowed', () => {
    expect(meleeSelectable('training', 'all')).toBe(true);
    expect(meleeSelectable('training', 'sword')).toBe(true);
    expect(meleeSelectable('match', 'all')).toBe(false);
    expect(meleeSelectable('match', 'sword')).toBe(false);
    expect(meleeSelectable('ctf', 'all')).toBe(false);
    expect(meleeSelectable('td', 'all')).toBe(false);
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
    expect(weaponAllowed('all', WEAPON_PISTOL)).toBe(true);
    expect(weaponAllowed('sword', WEAPON_PISTOL)).toBe(false);
  });
});

describe('weapon slots', () => {
  it('has five slots in key order; pistol, primary and taser fire bullets', () => {
    expect(WEAPON_PISTOL).toBe(0);
    expect(WEAPON_MELEE).toBe(1);
    expect(WEAPONS).toEqual([WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_MELEE, WEAPON_GRENADE, WEAPON_TASER]);
    expect(GUN_SLOTS).toEqual([WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER]);
    expect(isWeapon(4)).toBe(true);
    expect(isWeapon(5)).toBe(false);
    expect(isGunSlot(WEAPON_GRENADE)).toBe(false);
    expect(isGunSlot(WEAPON_TASER)).toBe(true);
  });
  it('two weapon modes: all allows every slot, sword only melee', () => {
    expect(WEAPON_MODES).toEqual(['all', 'sword']);
    expect(allowedWeapons('all')).toEqual([WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_MELEE, WEAPON_GRENADE, WEAPON_TASER]);
    expect(allowedWeapons('sword')).toEqual([WEAPON_MELEE]);
    expect(weaponAllowed('all', WEAPON_GRENADE)).toBe(true);
    expect(weaponAllowed('sword', WEAPON_PRIMARY)).toBe(false);
    expect(defaultWeapon('all')).toBe(WEAPON_PISTOL);
    expect(defaultWeapon('sword')).toBe(WEAPON_MELEE);
  });
});
