import * as THREE from 'three';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT, PHYSICS_DT, createPhysState, stepPlayer } from '@mineshoot/shared';
import type { MoveInput, PlayerPhysState, World } from '@mineshoot/shared';
import type { Keyboard } from '../input/keyboard';
import type { PointerLook } from '../input/pointerLock';

/**
 * Client-authoritative local body: fixed 60Hz physics from the shared
 * simulation, camera at eye height. Movement is frozen while dead.
 */
export class LocalPlayer {
  state: PlayerPhysState;
  alive = true;
  private acc = 0;
  /** Camera eye, eased between EYE_HEIGHT and CROUCH_EYE_HEIGHT so crouching dips rather than snaps. */
  private eyeY = EYE_HEIGHT;

  constructor(
    private readonly world: World,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly keys: Keyboard,
    private readonly look: PointerLook,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    this.state = createPhysState(x, y, z, yaw);
    this.look.yaw = yaw;
    this.look.pitch = 0;
    this.syncCamera();
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    this.state = createPhysState(x, y, z, yaw);
    this.look.yaw = yaw;
    this.look.pitch = 0;
    this.acc = 0;
    this.eyeY = EYE_HEIGHT; // a respawn stands you up; don't ease down from a stale crouch
    this.syncCamera();
  }

  /** Advance by frame time; returns true if the body moved horizontally. `speedScale` (0..1) slows walking, e.g. while charging the sword. `crouching` only dips the camera — the collider stays full height. */
  update(dtSec: number, inputEnabled: boolean, speedScale = 1, crouching = false): boolean {
    const wantEye = crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeY += (wantEye - this.eyeY) * (1 - Math.exp(-14 * Math.min(0.1, dtSec)));
    this.state.yaw = this.look.yaw;
    this.state.pitch = this.look.pitch;
    const input: MoveInput = { forward: 0, strafe: 0, jump: false };
    if (inputEnabled && this.alive) {
      if (this.keys.isDown('KeyW') || this.keys.isDown('ArrowUp')) input.forward += 1;
      if (this.keys.isDown('KeyS') || this.keys.isDown('ArrowDown')) input.forward -= 1;
      if (this.keys.isDown('KeyD') || this.keys.isDown('ArrowRight')) input.strafe += 1;
      if (this.keys.isDown('KeyA') || this.keys.isDown('ArrowLeft')) input.strafe -= 1;
      input.jump = this.keys.isDown('Space');
      input.forward *= speedScale;
      input.strafe *= speedScale;
    }
    const before = { x: this.state.x, z: this.state.z };
    this.acc = Math.min(this.acc + dtSec, 0.25);
    while (this.acc >= PHYSICS_DT) {
      this.acc -= PHYSICS_DT;
      this.state = stepPlayer(this.world, this.state, input, PHYSICS_DT);
    }
    this.syncCamera();
    return Math.hypot(this.state.x - before.x, this.state.z - before.z) > 1e-4;
  }

  private syncCamera(): void {
    this.camera.position.set(this.state.x, this.state.y + this.eyeY, this.state.z);
    this.camera.rotation.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
  }
}
