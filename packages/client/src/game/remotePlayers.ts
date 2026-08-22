import * as THREE from 'three';
import { ATTACK_HEAVY, INTERP_DELAY_MS, TEAM_NONE, attackSpec } from '@mineshoot/shared';
import type { AttackKind, GunKind, MeleeKind, Vec3, Weapon, World } from '@mineshoot/shared';
import { displayName } from '../net';
import type { NetPlayer } from '../net';
import { Humanoid } from '../render/humanoid';
import { createNametag } from '../render/nametag';
import { SnapshotBuffer } from './interpolation';
import type { Pose } from './interpolation';
import { nametagVisible } from './nametagVisibility';

interface Remote {
  humanoid: Humanoid;
  tag: ReturnType<typeof createNametag>;
  buffer: SnapshotBuffer;
  lastEpoch: number;
  weapon: Weapon;
  melee: MeleeKind;
  gun: GunKind;
  visible: boolean;
  /** Spectating this player: their own body must stay out of their own camera. */
  hidden: boolean;
  charging: boolean;
  reloading: boolean;
  crouching: boolean;
  color: number;
  team: number;
}

/** Nametag height above the feet: standing, and dropped with a crouching body. */
const TAG_Y = 2.15;
const TAG_Y_CROUCHED = 1.55;

/** The local player's view for gating nametags: eye ray + own team. */
export interface NametagAim {
  world: World;
  eye: Vec3;
  /** Unit look direction. */
  dir: Vec3;
  team: number;
}

/** Renders every other player as an interpolated blocky humanoid. */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private readonly remotes = new Map<string, Remote>();
  private lastFrame = 0;

  add(id: string, p: NetPlayer): void {
    if (this.remotes.has(id)) return;
    const humanoid = new Humanoid(p.color);
    const tag = createNametag(displayName(p.name, p.isBot));
    humanoid.group.add(tag.sprite);
    this.group.add(humanoid.group);
    const buffer = new SnapshotBuffer();
    buffer.push({ t: performance.now(), x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    humanoid.setPose(p.x, p.y, p.z, p.yaw, p.pitch, 0);
    humanoid.setWeapon(p.weapon as Weapon);
    humanoid.setMelee(p.melee as MeleeKind);
    humanoid.setGun(p.gun as GunKind);
    humanoid.setCharging(p.charging, performance.now());
    humanoid.setReloading(p.reloading);
    humanoid.setCrouching(p.crouching);
    tag.sprite.position.y = p.crouching ? TAG_Y_CROUCHED : TAG_Y;
    this.remotes.set(id, {
      humanoid,
      tag,
      buffer,
      lastEpoch: p.spawnEpoch,
      weapon: p.weapon as Weapon,
      melee: p.melee as MeleeKind,
      gun: p.gun as GunKind,
      visible: p.alive,
      hidden: false,
      charging: p.charging,
      reloading: p.reloading,
      crouching: p.crouching,
      color: p.color,
      team: p.team,
    });
    humanoid.group.visible = p.alive;
  }

  remove(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.group.remove(r.humanoid.group);
    r.humanoid.dispose();
    r.tag.dispose();
    this.remotes.delete(id);
  }

  /** Feed the latest synced pose (called on every state patch). */
  snapshot(id: string, p: NetPlayer, now: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (p.spawnEpoch !== r.lastEpoch) {
      // Teleport on respawn: don't lerp across the map.
      r.lastEpoch = p.spawnEpoch;
      r.buffer.clear();
    }
    r.buffer.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    if (p.weapon !== r.weapon) {
      r.weapon = p.weapon as Weapon;
      r.humanoid.setWeapon(r.weapon);
    }
    if (p.melee !== r.melee) {
      r.melee = p.melee as MeleeKind;
      r.humanoid.setMelee(r.melee);
    }
    if (p.alive !== r.visible) {
      r.visible = p.alive;
      r.humanoid.group.visible = p.alive && !r.hidden;
    }
    if (p.charging !== r.charging) {
      r.charging = p.charging;
      r.humanoid.setCharging(p.charging, now);
    }
    if (p.reloading !== r.reloading) {
      r.reloading = p.reloading;
      r.humanoid.setReloading(p.reloading);
    }
    if (p.crouching !== r.crouching) {
      r.crouching = p.crouching;
      r.humanoid.setCrouching(p.crouching);
      // The tag hangs off the (unsquashed) group, so it needs moving itself.
      r.tag.sprite.position.y = p.crouching ? TAG_Y_CROUCHED : TAG_Y;
    }
    if (p.color !== r.color) {
      // Team switches recolour a player mid-match; repaint or everyone keeps the stale colour.
      r.color = p.color;
      r.humanoid.setColor(p.color);
    }
    r.team = p.team;
  }

  /** A remote player attacked with `melee`: play the attack's animation. */
  swing(id: string, attack: AttackKind, melee: MeleeKind, now: number): void {
    this.remotes.get(id)?.humanoid.swing(now, attackSpec(melee, attack).anim, attack === ATTACK_HEAVY);
  }

  shot(id: string, now: number): void {
    this.remotes.get(id)?.humanoid.shot(now);
  }

  /** Rendered barrel tip of `id`'s held gun (tracer origin), or null (unknown player / no gun out). */
  muzzleWorld(id: string): Vec3 | null {
    const m = this.remotes.get(id)?.humanoid.muzzleWorld();
    return m ? { x: m.x, y: m.y, z: m.z } : null;
  }

  /**
   * Interpolated pose (feet + yaw/pitch) at the same render time the humanoids are drawn
   * at, or null if we don't know that player. Feeds the spectate camera.
   */
  pose(id: string, now: number): Pose | null {
    return this.remotes.get(id)?.buffer.sample(now - INTERP_DELAY_MS) ?? null;
  }

  /**
   * Keep a player's body (and their nametag, a child of it) out of the scene while alive —
   * used for the player we are spectating, whose eyes the camera is sitting in.
   */
  setHidden(id: string, hidden: boolean): void {
    const r = this.remotes.get(id);
    if (!r || r.hidden === hidden) return;
    r.hidden = hidden;
    r.humanoid.group.visible = r.visible && !hidden;
  }

  /** Feet position as currently rendered (interpolated), or null if we don't know that player. */
  position(id: string): Vec3 | null {
    const r = this.remotes.get(id);
    if (!r) return null;
    const p = r.humanoid.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  update(now: number, aim?: NametagAim): void {
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    const renderT = now - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const s = r.buffer.sample(renderT);
      if (s) r.humanoid.setPose(s.x, s.y, s.z, s.yaw, s.pitch, dt);
      r.humanoid.update(now);
      if (aim) {
        // Teammates stay labelled; anyone else only while the crosshair rests on
        // them with clear line of sight (tags must not reveal hidden players).
        const teammate = aim.team !== TEAM_NONE && r.team === aim.team;
        r.tag.sprite.visible = teammate || nametagVisible(aim.world, aim.eye, aim.dir, r.humanoid.group.position);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}
