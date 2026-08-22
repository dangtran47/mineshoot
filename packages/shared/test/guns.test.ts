import { describe, expect, it } from 'vitest';
import { GUN_COOLDOWN_MS, GUN_DAMAGE, GUN_MAG_SIZE, GUN_RANGE, GUN_RELOAD_MS } from '../src/constants';
import { GUN_KINDS, GUN_MACHINEGUN, GUN_NONE, GUN_PISTOL, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER, PRIMARY_KINDS, SPAWN_PRIMARY_KINDS, gunSpec, interruptedReloadAmmo, isGunKind, isPrimaryKind, pelletDirections, serverReloadMs, spawnPrimary } from '../src/guns';
import { forwardVector } from '../src/playerPhysics';
import { createRng } from '../src/rng';

describe('guns', () => {
  it("the pistol is today's gun", () => {
    const p = gunSpec(GUN_PISTOL);
    expect(p).toMatchObject({ magSize: GUN_MAG_SIZE, cooldownMs: GUN_COOLDOWN_MS, reloadMs: GUN_RELOAD_MS, range: GUN_RANGE, damage: GUN_DAMAGE, pellets: 1, spreadDeg: 0, auto: false });
  });
  it('every kind keeps the server rate limit slightly looser than the client cooldown', () => {
    for (const k of GUN_KINDS) {
      const s = gunSpec(k);
      expect(s.serverMinIntervalMs).toBeLessThan(s.cooldownMs);
      expect(s.serverMinIntervalMs).toBeGreaterThanOrEqual(s.cooldownMs - 60);
      if (s.reloadMs > 0) expect(s.serverReloadMinMs).toBeLessThan(s.reloadMs);
    }
  });
  it('primaries are rifle/smg/shotgun/sniper/m249; the taser (own slot) is consumable and cannot reload', () => {
    expect(PRIMARY_KINDS).not.toContain(GUN_NONE);
    expect(PRIMARY_KINDS).not.toContain(GUN_PISTOL);
    expect(PRIMARY_KINDS).not.toContain(GUN_TASER);
    expect(isPrimaryKind(GUN_SNIPER)).toBe(true);
    expect(isPrimaryKind(GUN_MACHINEGUN)).toBe(true);
    expect(isPrimaryKind(GUN_PISTOL)).toBe(false);
    expect(isPrimaryKind(GUN_TASER)).toBe(false);
    expect(isGunKind(GUN_MACHINEGUN)).toBe(true);
    expect(isGunKind(8)).toBe(false);
    const t = gunSpec(GUN_TASER);
    expect(t.consumable).toBe(true);
    expect(t.magSize).toBe(2);
    expect(t.reloadMs).toBe(0);
    expect(t.damage).toEqual({ head: 100, torso: 100, legs: 100 });
    expect(gunSpec(GUN_SNIPER).damage.torso).toBe(100);
    expect(gunSpec(GUN_SNIPER).zoom).toBeGreaterThan(1);
  });
  it('m249: full-auto machine gun — huge magazine, sustained fire, long punishing reload', () => {
    const m = gunSpec(GUN_MACHINEGUN);
    expect(m.name).toBe('M249');
    expect(m.magSize).toBe(75);
    expect(m.cooldownMs).toBe(100);
    expect(m.reloadMs).toBe(4500);
    expect(m.range).toBe(55);
    expect(m.damage).toEqual({ head: 45, torso: 18, legs: 9 });
    expect(m).toMatchObject({ pellets: 1, spreadDeg: 2.5, auto: true, zoom: 1, consumable: false, perShell: false });
  });
  it('unknown kinds fall back to the pistol spec', () => {
    expect(gunSpec(42 as never)).toBe(gunSpec(GUN_PISTOL));
  });
  it('pelletDirections: one exact ray for tight guns, N rays inside the cone for the shotgun (deterministic)', () => {
    const fwd = forwardVector(0.3, -0.1);
    expect(pelletDirections(0.3, -0.1, gunSpec(GUN_PISTOL), createRng(1))).toEqual([fwd]);
    const s = gunSpec(GUN_SHOTGUN);
    const a = pelletDirections(0.3, -0.1, s, createRng(5));
    const b = pelletDirections(0.3, -0.1, s, createRng(5));
    expect(a).toHaveLength(s.pellets);
    expect(a).toEqual(b);
    const cosMax = Math.cos((s.spreadDeg * Math.PI) / 180) - 1e-6;
    for (const d of a) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
      expect(d.x * fwd.x + d.y * fwd.y + d.z * fwd.z).toBeGreaterThanOrEqual(cosMax);
    }
    expect(new Set(a.map((d) => d.x)).size).toBeGreaterThan(1);
  });
  it('shotgun: hard-hitting fast pump gun that reloads one shell at a time', () => {
    const s = gunSpec(GUN_SHOTGUN);
    expect(s.cooldownMs).toBe(400);
    expect(s.damage).toEqual({ head: 45, torso: 25, legs: 12 });
    expect(s.perShell).toBe(true);
    expect(s.reloadMs).toBe(450); // per shell
    for (const k of GUN_KINDS) {
      if (k !== GUN_SHOTGUN) expect(gunSpec(k).perShell).toBe(false);
    }
  });
  it('serverReloadMs: full-mag window for normal guns, one shell interval per missing round for per-shell guns', () => {
    const pistol = gunSpec(GUN_PISTOL);
    expect(serverReloadMs(pistol, 0)).toBe(pistol.serverReloadMinMs);
    expect(serverReloadMs(pistol, pistol.magSize - 1)).toBe(pistol.serverReloadMinMs);
    const s = gunSpec(GUN_SHOTGUN);
    // One missing shell: one interval (minus the usual jitter slack, floored at the per-shell minimum).
    expect(serverReloadMs(s, s.magSize - 1)).toBe(s.serverReloadMinMs);
    // Empty: six shells, the slack applied once to the total.
    expect(serverReloadMs(s, 0)).toBe(s.magSize * s.reloadMs - (s.reloadMs - s.serverReloadMinMs));
  });
  it('interruptedReloadAmmo: a shot mid-reload keeps the shells already loaded (never fewer than before)', () => {
    const pistol = gunSpec(GUN_PISTOL);
    expect(interruptedReloadAmmo(pistol, 3, 500)).toBe(3); // full-mag reloads load nothing until they finish
    const s = gunSpec(GUN_SHOTGUN);
    const total = serverReloadMs(s, 0);
    expect(interruptedReloadAmmo(s, 0, total)).toBe(0); // no time has passed
    expect(interruptedReloadAmmo(s, 0, total - s.reloadMs)).toBe(1); // one shell in
    expect(interruptedReloadAmmo(s, 0, 0)).toBe(s.magSize); // ran to completion
    expect(interruptedReloadAmmo(s, 4, s.reloadMs * 2)).toBe(4); // never lowers what was already there
  });
  it('deathmatches with guns spawn a random primary; every other mode spawns none', () => {
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const k = spawnPrimary('match', 'all', rng);
      expect(SPAWN_PRIMARY_KINDS).toContain(k);
      seen.add(k);
    }
    expect(seen.size).toBe(SPAWN_PRIMARY_KINDS.length); // covers the pool
    expect(SPAWN_PRIMARY_KINDS).not.toContain(GUN_TASER); // the taser stays a pickup (2 charges then gone)
    expect(spawnPrimary('match', 'sword', rng)).toBe(GUN_NONE); // no guns at all
    expect(spawnPrimary('ctf', 'all', rng)).toBe(GUN_NONE); // teams: pistol by default
    expect(spawnPrimary('training', 'all', rng)).toBe(GUN_NONE); // range: pick your own
  });
});
