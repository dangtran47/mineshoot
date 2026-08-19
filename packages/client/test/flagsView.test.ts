import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TEAM_BLUE, TEAM_RED } from '@mineshoot/shared';
import type { Team } from '@mineshoot/shared';
import { FlagsView } from '../src/render/flagsView';
import { PLAYER_COLORS } from '../src/render/humanoid';

function root(view: FlagsView, team: Team): THREE.Group {
  const r = view.group.getObjectByName(`flag-${team}`);
  if (!(r instanceof THREE.Group)) throw new Error(`no flag root for team ${team}`);
  return r;
}

function part(view: FlagsView, team: Team, name: string): THREE.Mesh {
  const m = root(view, team).getObjectByName(name);
  if (!(m instanceof THREE.Mesh)) throw new Error(`no ${name} for team ${team}`);
  return m;
}

/** World-space bounding box of one mesh. */
function worldBox(view: FlagsView, mesh: THREE.Mesh): THREE.Box3 {
  view.group.updateMatrixWorld(true);
  return new THREE.Box3().expandByObject(mesh);
}

describe('FlagsView', () => {
  it('stands a home flag on the ground in the team colour', () => {
    const view = new FlagsView();
    view.set(TEAM_RED, { status: 'home', x: 10, y: 5, z: 10 });
    let meshes = 0;
    view.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(3);
    const pole = worldBox(view, part(view, TEAM_RED, 'pole'));
    expect(pole.min.y).toBeCloseTo(5, 2);
    expect(pole.max.y).toBeGreaterThan(7);
    const cloth = part(view, TEAM_RED, 'cloth');
    expect((cloth.material as THREE.MeshLambertMaterial).color.getHex()).toBe(PLAYER_COLORS[0]);
    view.set(TEAM_BLUE, { status: 'home', x: 20, y: 5, z: 20 });
    const blue = part(view, TEAM_BLUE, 'cloth');
    expect((blue.material as THREE.MeshLambertMaterial).color.getHex()).toBe(PLAYER_COLORS[1]);
    view.dispose();
  });

  it('keeps a dropped flag above the ground while it bobs and leans', () => {
    const view = new FlagsView();
    view.set(TEAM_RED, { status: 'dropped', x: 10, y: 5, z: 10 });
    const pole = part(view, TEAM_RED, 'pole');
    for (let t = 0; t < 4000; t += 125) {
      view.update(t);
      const box = worldBox(view, pole);
      expect(box.min.y).toBeGreaterThanOrEqual(5 - 0.01);
      // Still near the ground (leaning, not floating away).
      expect(box.min.y).toBeLessThan(5.5);
    }
    view.dispose();
  });

  it('lifts a carried flag onto the carrier\'s back', () => {
    const view = new FlagsView();
    view.set(TEAM_BLUE, { status: 'carried', x: 3, y: 12, z: 4 });
    view.update(500);
    const box = worldBox(view, part(view, TEAM_BLUE, 'pole'));
    expect(box.min.y).toBeCloseTo(13, 1);
    // Shorter than the standing pole.
    expect(box.max.y - box.min.y).toBeLessThan(2.6);
    // Follows the pose fed each frame.
    view.set(TEAM_BLUE, { status: 'carried', x: 30, y: 6, z: 40 });
    const moved = worldBox(view, part(view, TEAM_BLUE, 'pole'));
    expect(moved.min.y).toBeCloseTo(7, 1);
    expect(moved.min.x).toBeCloseTo(30 - 0.06, 1);
    view.dispose();
  });

  it('hides with set(team, null) and shows again', () => {
    const view = new FlagsView();
    view.set(TEAM_RED, { status: 'home', x: 1, y: 2, z: 3 });
    expect(root(view, TEAM_RED).visible).toBe(true);
    view.set(TEAM_RED, null);
    expect(root(view, TEAM_RED).visible).toBe(false);
    view.set(TEAM_RED, { status: 'home', x: 1, y: 2, z: 3 });
    expect(root(view, TEAM_RED).visible).toBe(true);
    // Hiding a flag that was never shown does not create garbage but is harmless.
    view.set(TEAM_BLUE, null);
    expect(root(view, TEAM_BLUE).visible).toBe(false);
    view.dispose();
  });

  it('shows both teams at once and dispose() empties the group', () => {
    const view = new FlagsView();
    view.set(TEAM_RED, { status: 'home', x: 10, y: 5, z: 10 });
    view.set(TEAM_BLUE, { status: 'dropped', x: 50, y: 7, z: 60 });
    view.update(1000);
    expect(view.group.children).toHaveLength(2);
    expect(root(view, TEAM_RED).position.x).toBe(10);
    expect(root(view, TEAM_BLUE).position.z).toBe(60);
    // Reusing the same team does not add a second flag.
    view.set(TEAM_RED, { status: 'carried', x: 11, y: 5, z: 11 });
    expect(view.group.children).toHaveLength(2);
    view.dispose();
    expect(view.group.children).toHaveLength(0);
  });
});
