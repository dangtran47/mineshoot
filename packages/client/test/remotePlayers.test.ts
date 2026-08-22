import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Block, INTERP_DELAY_MS, TEAM_BLUE, TEAM_NONE, TEAM_RED, createWorld, setBlock } from '@mineshoot/shared';
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
  assists: 0,
  spawnEpoch: 1,
  weapon: 0,
  melee: 0,
  pistol: 1,
  gun: 0,
  taser: 0,
  grenades: 0,
  ammo: 0,
  color: 0,
  isBot: false,
  shielded: false,
  charging: false,
  reloading: false,
  crouching: false,
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

describe('RemotePlayers.pose', () => {
  it('gives the interpolated pose at the render time, null for a stranger', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ x: 0, y: 1, z: 0 }));
    // add() seeds the buffer at performance.now(); stay ahead of it so the history is ordered.
    const t0 = performance.now() + 1000;
    rp.snapshot('a', player({ x: 0, y: 1, z: 0, yaw: 0, pitch: 0 }), t0);
    rp.snapshot('a', player({ x: 4, y: 1, z: 0, yaw: 1, pitch: 0.5 }), t0 + 100);
    // renderT = now - INTERP_DELAY_MS lands halfway between the two samples.
    const p = rp.pose('a', t0 + 50 + INTERP_DELAY_MS);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(2);
    expect(p!.yaw).toBeCloseTo(0.5);
    expect(p!.pitch).toBeCloseTo(0.25);
    expect(rp.pose('nobody', t0 + 50 + INTERP_DELAY_MS)).toBeNull();
    rp.dispose();
  });
});

describe('RemotePlayers.setHidden', () => {
  it('hides a living player and keeps them hidden across snapshots, until unhidden', () => {
    const rp = new RemotePlayers();
    rp.add('a', player());
    const body = (): boolean => rp.group.children[0].visible;
    expect(body()).toBe(true);
    rp.setHidden('a', true);
    expect(body()).toBe(false);
    rp.snapshot('a', player({ alive: true }), 1000);
    expect(body()).toBe(false);
    rp.setHidden('a', false);
    expect(body()).toBe(true);
    rp.dispose();
  });

  it('leaves a dead player hidden after unhiding', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ alive: false }));
    rp.setHidden('a', true);
    rp.setHidden('a', false);
    expect(rp.group.children[0].visible).toBe(false);
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

describe('RemotePlayers crouch', () => {
  it('drops the nametag when a player crouches and raises it again', () => {
    const rp = new RemotePlayers();
    rp.add('a', player());
    const standingY = tagSprite(rp).position.y;
    rp.snapshot('a', player({ crouching: true }), 1000);
    expect(tagSprite(rp).position.y).toBeLessThan(standingY);
    rp.snapshot('a', player({ crouching: false }), 1100);
    expect(tagSprite(rp).position.y).toBe(standingY);
    rp.dispose();
  });

  it('starts an already-crouching player crouched', () => {
    const rp = new RemotePlayers();
    rp.add('a', player({ crouching: true }));
    const crouchedY = tagSprite(rp).position.y;
    rp.snapshot('a', player({ crouching: false }), 1000);
    expect(tagSprite(rp).position.y).toBeGreaterThan(crouchedY);
    rp.dispose();
  });
});
