import { describe, expect, it } from 'vitest';
import { GUN_PISTOL, GUN_RIFLE, GUN_SNIPER, RECOIL_RECOVER_DEG_PER_S, recoilKick, recoilKickMs, recoilResetMs, gunSpec } from '@mineshoot/shared';
import { RecoilController } from '../src/game/recoil';
import { PITCH_LIMIT } from '../src/input/pointerLock';

const rad = (deg: number): number => (deg * Math.PI) / 180;
const RIFLE_RESET = recoilResetMs(gunSpec(GUN_RIFLE));

function make(pitch = 0, yaw = 0) {
  const look = { yaw, pitch, onDelta: null as ((dYaw: number, dPitch: number) => void) | null };
  const recoil = new RecoilController(look);
  return { look, recoil };
}

describe('RecoilController', () => {
  it('a kick pushes the camera up (and sideways per the pattern) for real', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_RIFLE, 1000);
    expect(look.pitch).toBeCloseTo(rad(recoilKick(GUN_RIFLE, 0).pitchDeg));
    recoil.kick(GUN_RIFLE, 1150);
    expect(look.pitch).toBeCloseTo(rad(recoilKick(GUN_RIFLE, 0).pitchDeg + recoilKick(GUN_RIFLE, 1).pitchDeg));
  });
  it('shots inside a burst walk the pattern; a long pause resets it', () => {
    const { look, recoil } = make();
    let t = 1000;
    for (let i = 0; i < 6; i++) {
      recoil.kick(GUN_RIFLE, t);
      t += 150;
    }
    // Shot 5 (index 4+) has the pattern's right drift applied.
    expect(look.yaw).toBeLessThan(0);
    const yawAfterBurst = look.yaw;
    t += RIFLE_RESET + 1;
    recoil.kick(GUN_RIFLE, t);
    // Back to the first pattern entry: straight up, no extra yaw.
    expect(look.yaw).toBeCloseTo(yawAfterBurst);
  });
  it('does not recover while the burst is still hot', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_RIFLE, 1000);
    const kicked = look.pitch;
    recoil.update(0.1, 1000 + RIFLE_RESET - 50);
    expect(look.pitch).toBeCloseTo(kicked);
  });
  it('after the burst the un-compensated part settles back to the original aim', () => {
    const { look, recoil } = make(0.2);
    recoil.kick(GUN_SNIPER, 1000);
    const t0 = 1000 + recoilResetMs(gunSpec(GUN_SNIPER)) + 1;
    // One small step moves at the recovery rate…
    recoil.update(0.05, t0);
    expect(look.pitch).toBeCloseTo(0.2 + rad(4.0) - rad(RECOIL_RECOVER_DEG_PER_S) * 0.05);
    // …and many steps land exactly on the original aim, no overshoot.
    for (let i = 0; i < 100; i++) recoil.update(0.05, t0 + i);
    expect(look.pitch).toBeCloseTo(0.2);
  });
  it('pulling the mouse down against the kick is subtracted, so recovery never overshoots', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_SNIPER, 1000);
    // Player compensates half the kick (PointerLook applies the move, then reports it).
    const half = rad(2.0);
    look.pitch -= half;
    look.onDelta!(0, -half);
    recoil.update(10, 1000 + recoilResetMs(gunSpec(GUN_SNIPER)) + 1);
    expect(look.pitch).toBeCloseTo(0);
  });
  it('over-compensating zeroes the offset: nothing recovers, the aim stays where the player put it', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_PISTOL, 1000); // instant 1° kick
    const pull = rad(2.0);
    look.pitch -= pull;
    look.onDelta!(0, -pull);
    const aimed = look.pitch;
    recoil.update(10, 1000 + recoilResetMs(gunSpec(GUN_PISTOL)) + 1);
    expect(look.pitch).toBeCloseTo(aimed);
  });
  it('mouse movement along the kick direction does not grow the debt', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_SNIPER, 1000);
    look.pitch += 0.3; // player aims up on purpose
    look.onDelta!(0, 0.3);
    recoil.update(10, 1000 + recoilResetMs(gunSpec(GUN_SNIPER)) + 1);
    expect(look.pitch).toBeCloseTo(0.3); // only the kick recovered, not the deliberate aim
  });
  it('a kick at the pitch limit only counts what was actually applied', () => {
    const start = PITCH_LIMIT - rad(1.0);
    const { look, recoil } = make(start);
    recoil.kick(GUN_SNIPER, 1000); // 4° kick, only 1° of room
    recoil.update(0.2, 1000 + recoilKickMs(GUN_SNIPER)); // the ramp finishes against the clamp
    expect(look.pitch).toBeCloseTo(PITCH_LIMIT);
    recoil.update(10, 1000 + recoilResetMs(gunSpec(GUN_SNIPER)) + 1);
    expect(look.pitch).toBeCloseTo(start); // recovers the 1° that was applied, no more
  });
  it('a heavy single-shot kick ramps up over recoilKickMs instead of snapping', () => {
    const { look, recoil } = make();
    const kickMs = recoilKickMs(GUN_SNIPER);
    recoil.kick(GUN_SNIPER, 1000);
    expect(look.pitch).toBeCloseTo(0); // nothing applied yet: the kick is an animation, not a snap
    recoil.update(kickMs / 2 / 1000, 1000 + kickMs / 2);
    expect(look.pitch).toBeCloseTo(rad(2.0)); // halfway through the ramp: half the kick
    recoil.update(kickMs / 2 / 1000, 1000 + kickMs);
    expect(look.pitch).toBeCloseTo(rad(4.0)); // ramp done: the full kick
  });
  it('a late frame past the ramp deadline applies the whole remaining kick at once', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_SNIPER, 1000);
    recoil.update(0.001, 1000 + recoilKickMs(GUN_SNIPER) + 50); // one tiny frame, long after the deadline
    expect(look.pitch).toBeCloseTo(rad(4.0));
  });
  it('compensating during the ramp is credited: recovery returns to the compensated aim, never below', () => {
    const { look, recoil } = make();
    recoil.kick(GUN_SNIPER, 1000);
    const pull = rad(2.0);
    look.pitch -= pull; // player pulls down while the kick is still ramping
    look.onDelta!(0, -pull);
    recoil.update(0.2, 1000 + recoilKickMs(GUN_SNIPER) + 1); // ramp finishes
    expect(look.pitch).toBeCloseTo(rad(2.0)); // net: 4° kick minus the 2° pull
    recoil.update(10, 1000 + recoilResetMs(gunSpec(GUN_SNIPER)) + 1);
    expect(look.pitch).toBeCloseTo(0); // only the un-compensated 2° recovers
  });
  it('yaw kicks recover too', () => {
    const { look, recoil } = make();
    let t = 1000;
    for (let i = 0; i < 6; i++) {
      recoil.kick(GUN_RIFLE, t);
      t += 150;
    }
    expect(look.yaw).not.toBeCloseTo(0);
    recoil.update(10, t + RIFLE_RESET + 1);
    expect(look.yaw).toBeCloseTo(0);
    expect(look.pitch).toBeCloseTo(0);
  });
  it('dispose unhooks the mouse listener', () => {
    const { look, recoil } = make();
    recoil.dispose();
    expect(look.onDelta).toBeNull();
  });
});
