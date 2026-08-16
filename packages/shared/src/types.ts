export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export enum Block {
  Air = 0,
  Bedrock = 1,
  Stone = 2,
  Dirt = 3,
  Grass = 4,
  Planks = 5,
  Brick = 6,
  Leaves = 7,
}

/** Dense voxel grid; index = (y * sz + z) * sx + x. */
export interface World {
  sx: number;
  sy: number;
  sz: number;
  blocks: Uint8Array;
}

/** Feet position (block center in x/z, standing on the block below). */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** Feet position + look angles. yaw: radians around +Y (0 = looking -Z). pitch: radians, + = up. */
export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerPhysState extends PlayerPose {
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

export interface MoveInput {
  /** -1..1, + = forward */
  forward: number;
  /** -1..1, + = right */
  strafe: number;
  jump: boolean;
}

export type VoxelHit =
  | { hit: true; bx: number; by: number; bz: number; point: Vec3; normal: Vec3; t: number }
  | { hit: false };

export interface RankRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
}
