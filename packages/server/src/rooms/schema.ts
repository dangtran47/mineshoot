import { MapSchema, Schema, type } from '@colyseus/schema';

export class PlayerSchema extends Schema {
  @type('string') name = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  @type('float32') pitch = 0;
  @type('boolean') alive = true;
  @type('uint16') kills = 0;
  @type('uint16') deaths = 0;
  /** Bumped on every (re)spawn; the owning client teleports to x/y/z when it changes. */
  @type('uint16') spawnEpoch = 0;
  @type('uint8') weapon = 0;
  @type('uint8') color = 0;
}

export class RoomState extends Schema {
  @type('string') phase = 'playing';
  @type('string') name = '';
  @type('uint32') seed = 0;
  @type('uint8') durationMin = 10;
  /** Server-authoritative countdown, refreshed once per second. */
  @type('uint32') timeLeftMs = 0;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
