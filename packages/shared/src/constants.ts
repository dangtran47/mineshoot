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
export const SERVER_TICK_MS = 50;
export const POSE_INTERVAL_MS = 1000 / POSE_HZ;
export const INTERP_DELAY_MS = 100;

// Weapons
export const GUN_COOLDOWN_MS = 350;
export const GUN_SERVER_MIN_INTERVAL_MS = 300;
export const GUN_RANGE = 60;
/** Rounds per magazine; reloads are unlimited. */
export const GUN_MAG_SIZE = 10;
export const GUN_RELOAD_MS = 1500;
/** Server accepts a post-reload shot slightly early to absorb network jitter. */
export const GUN_RELOAD_SERVER_MIN_MS = 1400;
export const SWORD_RANGE = 3;
/** Light (LMB tap) slash cone half-angle; a light slash hits only the nearest target inside it. */
export const SWORD_HALF_ANGLE_DEG = 28;
export const SWORD_HALF_ANGLE_COS = Math.cos((SWORD_HALF_ANGLE_DEG * Math.PI) / 180);
/** Heavy (RMB held, then released) overhead cone half-angle: narrower, but sweeps every target inside it. */
export const SWORD_HEAVY_HALF_ANGLE_DEG = 20;
export const SWORD_HEAVY_HALF_ANGLE_COS = Math.cos((SWORD_HEAVY_HALF_ANGLE_DEG * Math.PI) / 180);
export const SWORD_COOLDOWN_MS = 500;
export const SWORD_SERVER_MIN_INTERVAL_MS = 450;

// Match
export const RESPAWN_MS = 3000;
/** Respawn delay in training rooms (dummies and players alike): the range refills almost at once. */
export const TRAINING_RESPAWN_MS = 1000;
/** Damage immunity after every (re)spawn; ends early when the player attacks. */
export const SPAWN_PROTECT_MS = 2000;
export const MAX_PLAYERS = 8;
export const MAX_BOTS = 7;
export const MAX_NAME_LEN = 12;
export const DURATION_OPTIONS_MIN = [3, 5, 10, 15] as const;
export const DEFAULT_DURATION_MIN = 10;
export const ENDED_LINGER_MS = 15_000;
export const PLAYER_COLOR_COUNT = 8;

// Health / damage
export const MAX_HP = 100;
/** Sword damage by swing type (light LMB vs. heavy RMB hold) and hit location (head vs. anywhere else). */
export const SWORD_DAMAGE = {
  normal: { head: 45, body: 30 },
  charged: { head: 100, body: 70 },
} as const;
/** Hold RMB with the sword at least this long before releasing for the heavy swing. */
export const SWORD_CHARGE_MS = 800;
/** Holding the sword this long releases the (charged) swing automatically; press again to charge anew. */
export const SWORD_CHARGE_MAX_MS = 2000;
/** Walk-speed multiplier while a sword charge is held (client-side; the charge is a commitment). */
export const SWORD_CHARGE_SPEED_SCALE = 0.7;
export const GUN_DAMAGE = { head: 100, torso: 30, legs: 15 } as const;

// Body-part hitboxes (feet-relative y bands; x/z half-widths). Match client render/humanoid.ts.
export const HEAD_HALF_W = 0.235; // 0.47 head + hair
export const LEGS_TOP = 0.7; // legs 0..0.7
export const TORSO_TOP = 1.35; // torso 0.7..1.35, head 1.35..PLAYER_HEIGHT
