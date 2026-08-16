import * as THREE from 'three';
import { INTERP_DELAY_MS } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';
import type { NetPlayer } from '../net';
import { Humanoid } from '../render/humanoid';
import { createNametag } from '../render/nametag';
import { SnapshotBuffer } from './interpolation';

interface Remote {
  humanoid: Humanoid;
  tag: ReturnType<typeof createNametag>;
  buffer: SnapshotBuffer;
  lastEpoch: number;
  weapon: Weapon;
  visible: boolean;
}

/** Renders every other player as an interpolated blocky humanoid. */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private readonly remotes = new Map<string, Remote>();
  private lastFrame = 0;

  add(id: string, p: NetPlayer): void {
    if (this.remotes.has(id)) return;
    const humanoid = new Humanoid(p.color);
    const tag = createNametag(p.name);
    humanoid.group.add(tag.sprite);
    this.group.add(humanoid.group);
    const buffer = new SnapshotBuffer();
    buffer.push({ t: performance.now(), x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    humanoid.setPose(p.x, p.y, p.z, p.yaw, p.pitch, 0);
    this.remotes.set(id, { humanoid, tag, buffer, lastEpoch: p.spawnEpoch, weapon: p.weapon as Weapon, visible: p.alive });
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
    if (p.alive !== r.visible) {
      r.visible = p.alive;
      r.humanoid.group.visible = p.alive;
    }
  }

  swing(id: string): void {
    this.remotes.get(id)?.humanoid.swing();
  }

  update(now: number): void {
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    const renderT = now - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const s = r.buffer.sample(renderT);
      if (s) r.humanoid.setPose(s.x, s.y, s.z, s.yaw, s.pitch, dt);
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}
