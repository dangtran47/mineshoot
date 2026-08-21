import { RECOIL_RECOVER_DEG_PER_S, gunSpec, recoilKick, recoilKickMs, recoilResetMs } from '@mineshoot/shared';
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
 * bullet path. Heavy single-shot kicks (see `recoilKickMs`) ramp up over a
 * short window instead of landing in one frame; the pending part is drained in
 * `update`. Mouse movement *against* the kick (reported via `onDelta`) pays
 * the debt down — including the still-pending part of a ramping kick — so
 * recovery returns exactly to the pre-spray aim and a player who compensated
 * is never yanked below it.
 */
export class RecoilController {
  /** Un-compensated recoil still owed back to the player, radians. */
  private pitchOffset = 0;
  private yawOffset = 0;
  /** Kick deflection not yet applied to the camera (ramping), radians. */
  private pendingPitch = 0;
  private pendingYaw = 0;
  private kickEndAt = -Infinity;
  private kickPitchPerMs = 0;
  private kickYawPerMs = 0;
  private shotIndex = 0;
  private lastKickAt = -Infinity;
  private resetMs = 300;

  constructor(private readonly look: RecoilLook) {
    look.onDelta = (dYaw, dPitch) => {
      this.yawOffset = payDown(this.yawOffset, dYaw, this.pendingYaw);
      this.pitchOffset = payDown(this.pitchOffset, dPitch, this.pendingPitch);
    };
  }

  /** One shot fired: advance the burst and punch the camera along the pattern. */
  kick(kind: GunKind, now: number): void {
    if (now - this.lastKickAt > this.resetMs) this.shotIndex = 0;
    this.lastKickAt = now;
    this.resetMs = recoilResetMs(gunSpec(kind));
    const k = recoilKick(kind, this.shotIndex++);
    const kickMs = recoilKickMs(kind);
    if (kickMs <= 0) {
      this.apply(k.pitchDeg * RAD_PER_DEG, k.yawDeg * RAD_PER_DEG);
      return;
    }
    this.pendingPitch += k.pitchDeg * RAD_PER_DEG;
    this.pendingYaw += k.yawDeg * RAD_PER_DEG;
    this.kickEndAt = now + kickMs;
    this.kickPitchPerMs = this.pendingPitch / kickMs;
    this.kickYawPerMs = this.pendingYaw / kickMs;
  }

  /** Drain any ramping kick into the camera, then, once the burst has gone cold, drift the offset back to zero. */
  update(dt: number, now: number): void {
    if (this.pendingPitch !== 0 || this.pendingYaw !== 0) {
      const all = now >= this.kickEndAt; // a late frame lands the rest at once
      const dPitch = all ? this.pendingPitch : clampMag(this.pendingPitch, Math.abs(this.kickPitchPerMs) * dt * 1000);
      const dYaw = all ? this.pendingYaw : clampMag(this.pendingYaw, Math.abs(this.kickYawPerMs) * dt * 1000);
      this.pendingPitch -= dPitch;
      this.pendingYaw -= dYaw;
      this.apply(dPitch, dYaw);
    }
    if (now - this.lastKickAt <= this.resetMs) return;
    const step = RECOIL_RECOVER_DEG_PER_S * RAD_PER_DEG * dt;
    const dPitch = clampMag(this.pitchOffset, step);
    const dYaw = clampMag(this.yawOffset, step);
    this.look.pitch -= dPitch;
    this.pitchOffset -= dPitch;
    this.look.yaw -= dYaw;
    this.yawOffset -= dYaw;
  }

  /** Move the camera by a kick slice; only the part the pitch clamp lets through counts as debt. */
  private apply(dPitch: number, dYaw: number): void {
    const pitchApplied = Math.min(this.look.pitch + dPitch, PITCH_LIMIT) - this.look.pitch;
    this.look.pitch += pitchApplied;
    this.pitchOffset += pitchApplied;
    this.look.yaw += dYaw;
    this.yawOffset += dYaw;
  }

  dispose(): void {
    this.look.onDelta = null;
  }
}

/**
 * Shrink the recoil debt toward 0 by any part of `delta` that opposes it
 * (never grow it). The debt a mouse move can pay includes the still-pending
 * part of a ramping kick: paying early drives `offset` negative down to
 * `-pending`, and the pending application then nets it back out.
 */
function payDown(offset: number, delta: number, pending: number): number {
  const total = offset + pending;
  if (total > 0 && delta < 0) return Math.max(offset + delta, -Math.max(0, pending));
  if (total < 0 && delta > 0) return Math.min(offset + delta, -Math.min(0, pending));
  return offset;
}

/** `offset` clipped to ±`mag`: the recovery step never overshoots zero. */
function clampMag(offset: number, mag: number): number {
  return Math.max(-mag, Math.min(mag, offset));
}
