import { RECOIL_RECOVER_DEG_PER_S, gunSpec, recoilKick, recoilResetMs } from '@mineshoot/shared';
import type { GunKind } from '@mineshoot/shared';
import { PITCH_LIMIT } from '../input/pointerLock';

const RAD_PER_DEG = Math.PI / 180;

/** The slice of PointerLook the controller drives (a plain object in tests). */
export interface RecoilLook {
  yaw: number;
  pitch: number;
  onDelta: ((dYaw: number, dPitch: number) => void) | null;
}

/**
 * Applies the per-gun spray pattern (shared `RECOIL_PATTERNS`) to the camera
 * and settles the un-compensated part back after the burst. Each kick moves
 * `look` directly — aim is client-authoritative, so the kick bends the real
 * bullet path. Mouse movement *against* the kick (reported via `onDelta`)
 * pays the debt down, so recovery returns exactly to the pre-spray aim and
 * a player who compensated is never yanked below it.
 */
export class RecoilController {
  /** Un-compensated recoil still owed back to the player, radians. */
  private pitchOffset = 0;
  private yawOffset = 0;
  private shotIndex = 0;
  private lastKickAt = -Infinity;
  private resetMs = 300;

  constructor(private readonly look: RecoilLook) {
    look.onDelta = (dYaw, dPitch) => {
      this.yawOffset = payDown(this.yawOffset, dYaw);
      this.pitchOffset = payDown(this.pitchOffset, dPitch);
    };
  }

  /** One shot fired: advance the burst and punch the camera along the pattern. */
  kick(kind: GunKind, now: number): void {
    if (now - this.lastKickAt > this.resetMs) this.shotIndex = 0;
    this.lastKickAt = now;
    this.resetMs = recoilResetMs(gunSpec(kind));
    const k = recoilKick(kind, this.shotIndex++);
    // Only the part the pitch clamp lets through counts as debt.
    const pitchApplied = Math.min(this.look.pitch + k.pitchDeg * RAD_PER_DEG, PITCH_LIMIT) - this.look.pitch;
    this.look.pitch += pitchApplied;
    this.pitchOffset += pitchApplied;
    this.look.yaw += k.yawDeg * RAD_PER_DEG;
    this.yawOffset += k.yawDeg * RAD_PER_DEG;
  }

  /** Once the burst has gone cold, drift the remaining offset back to zero. */
  update(dt: number, now: number): void {
    if (now - this.lastKickAt <= this.resetMs) return;
    const step = RECOIL_RECOVER_DEG_PER_S * RAD_PER_DEG * dt;
    const dPitch = clampMag(this.pitchOffset, step);
    const dYaw = clampMag(this.yawOffset, step);
    this.look.pitch -= dPitch;
    this.pitchOffset -= dPitch;
    this.look.yaw -= dYaw;
    this.yawOffset -= dYaw;
  }

  dispose(): void {
    this.look.onDelta = null;
  }
}

/** Shrink `offset` toward 0 by any part of `delta` that opposes it (never grow it). */
function payDown(offset: number, delta: number): number {
  if (offset > 0 && delta < 0) return Math.max(0, offset + delta);
  if (offset < 0 && delta > 0) return Math.min(0, offset + delta);
  return offset;
}

/** `offset` clipped to ±`mag`: the recovery step never overshoots zero. */
function clampMag(offset: number, mag: number): number {
  return Math.max(-mag, Math.min(mag, offset));
}
