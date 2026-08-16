// World
export const WORLD_SX = 64;
export const WORLD_SY = 24;
export const WORLD_SZ = 64;
export const CHUNK = 16;

// Player body
export const PLAYER_HALF_W = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

// Movement
export const WALK_SPEED = 5.5;
export const AIR_CONTROL = 0.25;
export const GRAVITY = 28;
export const JUMP_SPEED = 8.5;
export const MAX_FALL = 50;
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

// Networking cadence
export const POSE_HZ = 20;
export const POSE_INTERVAL_MS = 1000 / POSE_HZ;
export const INTERP_DELAY_MS = 100;

// Weapons
export const GUN_COOLDOWN_MS = 350;
export const GUN_SERVER_MIN_INTERVAL_MS = 300;
export const GUN_RANGE = 60;
export const SWORD_RANGE = 3;
export const SWORD_HALF_ANGLE_DEG = 40;
export const SWORD_HALF_ANGLE_COS = Math.cos((SWORD_HALF_ANGLE_DEG * Math.PI) / 180);
export const SWORD_COOLDOWN_MS = 500;
export const SWORD_SERVER_MIN_INTERVAL_MS = 450;

// Match
export const RESPAWN_MS = 3000;
export const MAX_PLAYERS = 8;
export const MAX_NAME_LEN = 12;
export const DURATION_OPTIONS_MIN = [3, 5, 10, 15] as const;
export const DEFAULT_DURATION_MIN = 10;
export const ENDED_LINGER_MS = 15_000;
export const PLAYER_COLOR_COUNT = 8;
