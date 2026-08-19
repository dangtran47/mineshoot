import { MapSchema, Schema, type } from '@colyseus/schema';
import { CTF_DEFAULT_CAPTURE_LIMIT, MAX_HP, MELEE_SWORD, TEAM_NONE } from '@mineshoot/shared';

export class PlayerSchema extends Schema {
  @type('string') name = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  @type('float32') pitch = 0;
  @type('boolean') alive = true;
  @type('uint8') hp = MAX_HP;
  @type('uint16') kills = 0;
  @type('uint16') deaths = 0;
  /** Bumped on every (re)spawn; the owning client teleports to x/y/z when it changes. */
  @type('uint16') spawnEpoch = 0;
  @type('uint8') weapon = 0;
  /** Melee weapon in slot 2 (MeleeKind): the sword, or a picked-up drop. Reset on every spawn. */
  @type('uint8') melee = MELEE_SWORD;
  @type('uint8') color = 0;
  @type('boolean') isBot = false;
  /** Spawn protection: cannot be targeted or damaged (ends after SPAWN_PROTECT_MS or on the first attack). */
  @type('boolean') shielded = false;
  /** Holding a sword charge (wind-up visible to everyone). */
  @type('boolean') charging = false;
  /** Reloading the gun. */
  @type('boolean') reloading = false;
  /** CTF: TEAM_RED / TEAM_BLUE; TEAM_NONE in other modes. */
  @type('uint8') team = TEAM_NONE;
  /** CTF: flags captured. */
  @type('uint16') captures = 0;
}

/** A melee weapon lying on the ground, waiting to be picked up. */
export class DropSchema extends Schema {
  @type('uint8') kind = MELEE_SWORD;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
}

/** CTF: one team's flag. While carried, x/y/z follow the carrier. */
export class FlagSchema extends Schema {
  @type('uint8') team = TEAM_NONE;
  /** 'home' | 'carried' | 'dropped' */
  @type('string') status = 'home';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  /** Session id of the carrier while carried, '' otherwise. */
  @type('string') carrierId = '';
}

export class RoomState extends Schema {
  @type('string') phase = 'playing';
  @type('string') name = '';
  @type('uint32') seed = 0;
  @type('uint8') durationMin = 10;
  /** Allowed weapons: 'all' | 'gun' | 'sword'. */
  @type('string') weapons = 'all';
  /** Room kind: 'match' | 'training' (practice range with passive dummies and free melee choice). */
  @type('string') mode = 'match';
  /** Server-authoritative countdown, refreshed once per second. */
  @type('uint32') timeLeftMs = 0;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: DropSchema }) drops = new MapSchema<DropSchema>();
  /** CTF: flags keyed by team ('1' red, '2' blue); empty in other modes. */
  @type({ map: FlagSchema }) flags = new MapSchema<FlagSchema>();
  @type('uint8') redScore = 0;
  @type('uint8') blueScore = 0;
  /** CTF: captures needed to win. */
  @type('uint8') captureLimit = CTF_DEFAULT_CAPTURE_LIMIT;
}
