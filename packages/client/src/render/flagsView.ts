import * as THREE from 'three';
import { TEAM_RED } from '@mineshoot/shared';
import type { FlagStatus, Team } from '@mineshoot/shared';
import { PLAYER_COLORS } from './humanoid';

export interface FlagPose {
  status: FlagStatus;
  x: number;
  y: number;
  z: number;
}

interface FlagView {
  /** Positioned at the pose (feet, block coords); toggled with `visible`. */
  root: THREE.Group;
  /** Pole + cloth: leans when dropped, bobs, shrinks/lifts when carried. */
  lean: THREE.Group;
  /** Hinge on the pole edge the cloth waves around. */
  clothPivot: THREE.Group;
  cloth: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
  padMat: THREE.MeshBasicMaterial;
  status: FlagStatus;
  phase: number;
}

const POLE_W = 0.12;
const POLE_H = 2.6;
const CLOTH_W = 0.95;
const CLOTH_H = 0.6;
const CLOTH_T = 0.06;
const BEACON_H = 8;
const BEACON_OPACITY = 0.28;
const PAD_OPACITY = 0.5;
/** Dropped: how far the pole leans and how it bobs (never lower than the leaning base corner). */
const DROP_TILT = 0.5;
const DROP_HOVER = 0.12;
const DROP_BOB = 0.06;
/** Carried: pole shrunk and lifted so it sits on the carrier's back. */
const CARRY_SCALE = 0.75;
const CARRY_LIFT = 1.0;
const POLE_COLOR = 0x8a8f96;

function teamColor(team: Team): number {
  return PLAYER_COLORS[team === TEAM_RED ? 0 : 1];
}

/**
 * The two CTF flags: a pole with a waving team-coloured cloth under a tall
 * translucent light column so each flag can be spotted from across the map.
 * Home flags stand upright, dropped ones lean and bob, carried ones ride on
 * the carrier's back (the game screen feeds the carrier's position each frame).
 */
export class FlagsView {
  readonly group = new THREE.Group();
  private readonly flags = new Map<Team, FlagView>();
  private readonly poleGeo = new THREE.BoxGeometry(POLE_W, POLE_H, POLE_W);
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: POLE_COLOR });
  private readonly clothGeo = new THREE.BoxGeometry(CLOTH_W, CLOTH_H, CLOTH_T);
  private readonly beaconGeo = new THREE.BoxGeometry(0.4, BEACON_H, 0.4);
  private readonly padGeo = new THREE.BoxGeometry(1.2, 0.06, 1.2);
  private readonly clothMats = new Map<Team, THREE.MeshLambertMaterial>();

  /**
   * Show flag `team` at a pose (feet position, block coords), or hide it (null).
   * Called every frame by the game screen; carried flags are fed the carrier's rendered position.
   */
  set(team: Team, pose: FlagPose | null): void {
    const f = this.flags.get(team) ?? this.build(team);
    if (!pose) {
      f.root.visible = false;
      return;
    }
    f.root.visible = true;
    f.root.position.set(pose.x, pose.y, pose.z);
    if (f.status !== pose.status) {
      f.status = pose.status;
      this.applyStatus(f);
    }
  }

  /** Animate: cloth wave, dropped-flag bob/tilt, beacon pulse. */
  update(now: number): void {
    const t = now / 1000;
    for (const f of this.flags.values()) {
      if (!f.root.visible) continue;
      // Cloth flutters around the pole edge and breathes a little in width.
      f.clothPivot.rotation.y = Math.sin(t * 3.1 + f.phase) * 0.28 + Math.sin(t * 7.3 + f.phase) * 0.06;
      f.cloth.scale.x = 1 + Math.sin(t * 5.2 + f.phase) * 0.06;
      if (f.status === 'dropped') {
        f.lean.position.y = DROP_HOVER + Math.sin(t * 2.2 + f.phase) * DROP_BOB;
        f.lean.rotation.y = t * 0.6 + f.phase;
        f.beaconMat.opacity = 0.42 + Math.sin(t * 4) * 0.12;
      }
    }
  }

  dispose(): void {
    for (const f of this.flags.values()) {
      this.group.remove(f.root);
      f.beaconMat.dispose();
      f.padMat.dispose();
    }
    this.flags.clear();
    for (const m of this.clothMats.values()) m.dispose();
    this.clothMats.clear();
    this.poleGeo.dispose();
    this.poleMat.dispose();
    this.clothGeo.dispose();
    this.beaconGeo.dispose();
    this.padGeo.dispose();
  }

  private clothMat(team: Team): THREE.MeshLambertMaterial {
    let m = this.clothMats.get(team);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: teamColor(team) });
      this.clothMats.set(team, m);
    }
    return m;
  }

  private build(team: Team): FlagView {
    const color = teamColor(team);
    const root = new THREE.Group();
    root.name = `flag-${team}`;
    const lean = new THREE.Group();
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.name = 'pole';
    pole.position.y = POLE_H / 2;
    // Hinge on the pole's +x face just under the top; the cloth hangs from it, one edge touching the pole.
    const clothPivot = new THREE.Group();
    clothPivot.position.set(POLE_W / 2, POLE_H - CLOTH_H / 2 - 0.05, 0);
    const cloth = new THREE.Mesh(this.clothGeo, this.clothMat(team));
    cloth.name = 'cloth';
    cloth.position.x = CLOTH_W / 2;
    clothPivot.add(cloth);
    lean.add(pole, clothPivot);
    const beaconMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: BEACON_OPACITY, depthWrite: false });
    const beacon = new THREE.Mesh(this.beaconGeo, beaconMat);
    beacon.name = 'beacon';
    beacon.position.y = BEACON_H / 2;
    const padMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: PAD_OPACITY, depthWrite: false });
    const pad = new THREE.Mesh(this.padGeo, padMat);
    pad.name = 'pad';
    pad.position.y = 0.04;
    root.add(lean, beacon, pad);
    this.group.add(root);
    const f: FlagView = { root, lean, clothPivot, cloth, beaconMat, padMat, status: 'home', phase: team * 2.1 };
    this.applyStatus(f);
    this.flags.set(team, f);
    return f;
  }

  private applyStatus(f: FlagView): void {
    const { lean } = f;
    lean.rotation.set(0, 0, 0);
    lean.scale.setScalar(1);
    f.beaconMat.opacity = BEACON_OPACITY;
    switch (f.status) {
      case 'home':
        lean.position.set(0, 0, 0);
        break;
      case 'dropped':
        lean.position.set(0, DROP_HOVER, 0);
        lean.rotation.z = DROP_TILT;
        break;
      case 'carried':
        lean.position.set(0, CARRY_LIFT, 0);
        lean.scale.y = CARRY_SCALE;
        break;
    }
  }
}
