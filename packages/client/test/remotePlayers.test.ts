import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Block, TEAM_BLUE, TEAM_NONE, TEAM_RED, createWorld, setBlock } from '@mineshoot/shared';
import type { World } from '@mineshoot/shared';
import type { NetPlayer } from '../src/net';
import { PLAYER_COLORS } from '../src/render/humanoid';
import { RemotePlayers } from '../src/game/remotePlayers';

// createNametag draws to a 2D canvas, which node's test environment lacks.
vi.mock('../src/render/nametag', () => ({
  createNametag: () => ({ sprite: new THREE.Sprite(), dispose() {} }),
}));

const player = (over: Partial<NetPlayer> = {}): NetPlayer => ({
  name: 'bob',
  x: 14.5,
  y: 1,
  z: 4.5,
  yaw: 0,
  pitch: 0,
  alive: true,
  hp: 100,
  kills: 0,
  deaths: 0,
  spawnEpoch: 1,
  weapon: 0,
  melee: 0,
  pistol: 1,
  gun: 0,
  taser: 0,
  grenades: 0,
  color: 0,
  isBot: false,
  shielded: false,
  charging: false,
  reloading: false,
  team: TEAM_NONE,
  captures: 0,
  ...over,
});

const meshColors = (rp: RemotePlayers): Set<number> => {
  const colors = new Set<number>();
  rp.group.traverse((o) => {
    if (o instanceof THREE.Mesh) colors.add((o.material as THREE.MeshLambertMaterial).color.getHex());
  });
  return colors;
};

const tagSprite = (rp: RemotePlayers): THREE.Sprite => {
  let sprite: THREE.Sprite | null = null;
  rp.group.traverse((o) => {
    if (o instanceof THREE.Sprite) sprite = o;
  });
  if (!sprite) throw new Error('no nametag sprite found');
  return sprite;
};

const flatWorld = (): World => {
  const w = createWorld(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
};

const eye = { x: 4.5, y: 1 + 1.62, z: 4.5 };

describe('RemotePlayers colors', () => {
  it('repaints the humanoid when the synced color changes (team switch)', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ color: 0 }));
    expect(meshColors(rp)).toContain(PLAYER_COLORS[0]);
    rp.snapshot('a', player({ color: 3 }), 1000);
    const colors = meshColors(rp);
    expect(colors).toContain(PLAYER_COLORS[3]);
    expect(colors).not.toContain(PLAYER_COLORS[0]);
    rp.dispose();
  });
});

describe('RemotePlayers.muzzleWorld', () => {
  it('gives the rendered gun tip for a known shooter, null otherwise', () => {
    const rp = new RemotePlayers();
    rp.add('a', player()); // pistol out by default (weapon 0)
    rp.update(0);
    const m = rp.muzzleWorld('a');
    expect(m).not.toBeNull();
    expect(Math.hypot(m!.x - 14.5, m!.z - 4.5)).toBeLessThan(1.6); // at the player, not at the eye ray
    expect(m!.y).toBeGreaterThan(1); // in the raised arm
    expect(rp.muzzleWorld('nobody')).toBeNull();
    rp.dispose();
  });
});

describe('RemotePlayers nametag gating', () => {
  it('shows the tag only while the crosshair rests on that player', () => {
    const rp = new RemotePlayers();
    rp.add('a', player());
    const w = flatWorld();
    rp.update(0, { world: w, eye, dir: { x: 1, y: 0, z: 0 }, team: TEAM_NONE });
    expect(tagSprite(rp).visible).toBe(true);
    rp.update(16, { world: w, eye, dir: { x: 0, y: 0, z: 1 }, team: TEAM_NONE });
    expect(tagSprite(rp).visible).toBe(false);
    rp.dispose();
  });

  it('always shows a CTF teammate, never gates them', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ team: TEAM_RED }));
    const w = flatWorld();
    rp.update(0, { world: w, eye, dir: { x: 0, y: 0, z: 1 }, team: TEAM_RED });
    expect(tagSprite(rp).visible).toBe(true);
    rp.dispose();
  });

  it('gates a CTF enemy by crosshair like anyone else', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ team: TEAM_BLUE }));
    const w = flatWorld();
    rp.update(0, { world: w, eye, dir: { x: 0, y: 0, z: 1 }, team: TEAM_RED });
    expect(tagSprite(rp).visible).toBe(false);
    rp.update(16, { world: w, eye, dir: { x: 1, y: 0, z: 0 }, team: TEAM_RED });
    expect(tagSprite(rp).visible).toBe(true);
    rp.dispose();
  });

  it('follows a team switch synced through snapshot', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ team: TEAM_RED }));
    rp.snapshot('a', player({ team: TEAM_BLUE }), 1000);
    const w = flatWorld();
    rp.update(0, { world: w, eye, dir: { x: 0, y: 0, z: 1 }, team: TEAM_RED });
    expect(tagSprite(rp).visible).toBe(false);
    rp.dispose();
  });
});
