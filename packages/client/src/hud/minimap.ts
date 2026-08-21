import { EYE_HEIGHT, TEAM_BLUE, TEAM_RED, columnTop, getBlock } from '@mineshoot/shared';
import type { FlagStatus, SpawnPoint, Team, Vec3, World } from '@mineshoot/shared';
import {
  VISION_INTERVAL_MS,
  hasLineOfSight,
  terrainColor,
  updateFlagPin,
  visibleIds,
  worldToMap,
  yawToMapAngle,
} from '../game/minimapModel';
import type { FlagPin, MapDot } from '../game/minimapModel';

/** CSS pixels per block: 64×64 → 128 px square, 96×48 → 192×96. */
const SCALE = 2;
/** Roughly the middle of a flag pole, for the line-of-sight test. */
const FLAG_EYE = 0.9;

const RED = '#e74c3c';
const BLUE = '#3498db';
/** Deathmatch has no teams: everyone else is simply hostile. */
const HOSTILE = '#ff5c5c';
const SELF = '#e8ecf5';

const teamColor = (team: number, fallback: string): string =>
  team === TEAM_RED ? RED : team === TEAM_BLUE ? BLUE : fallback;

export interface MinimapFlag {
  status: FlagStatus;
  x: number;
  y: number;
  z: number;
}

/** Everything the map needs for one frame; assembled by the game screen. */
export interface MinimapFrame {
  self: { x: number; y: number; z: number; yaw: number; alive: boolean };
  myTeam: number;
  /** Always drawn — my living team-mates. */
  mates: MapDot[];
  /** Drawn only while somebody has line of sight. */
  enemies: { id: string; pos: Vec3; team: number }[];
  /** Feet positions of me plus my team-mates: everyone whose eyes reveal the map. */
  observers: Vec3[];
  ownFlag: MinimapFlag | null;
  enemyFlag: MinimapFlag | null;
}

/**
 * Top-down map in the corner of the HUD. Team-mates and my own flag are always
 * drawn; enemies and a stolen enemy flag only show while somebody on my side can
 * actually see them, with the enemy flag leaving a dimmed last-seen pin behind.
 *
 * The terrain is baked once into an offscreen canvas and blitted each frame, and
 * the line-of-sight sweep runs on its own slower tick — the per-frame cost is a
 * blit plus a handful of markers.
 */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly terrain: HTMLCanvasElement;
  private readonly w: number;
  private readonly h: number;
  private visible = new Set<string>();
  private pin: FlagPin | null = null;
  private lastVisionAt = 0;

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly bases: Record<Team, SpawnPoint> | null,
  ) {
    this.w = world.sx * SCALE;
    this.h = world.sz * SCALE;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.className = 'minimap';
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx = this.canvas.getContext('2d');
    this.ctx?.scale(dpr, dpr);
    this.terrain = this.bakeTerrain();
    parent.append(this.canvas);
  }

  /** One cell per column, tinted by the block on top and shaded by its height. */
  private bakeTerrain(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.world.sx;
    c.height = this.world.sz;
    const g = c.getContext('2d');
    if (!g) return c;
    for (let z = 0; z < this.world.sz; z++) {
      for (let x = 0; x < this.world.sx; x++) {
        const top = columnTop(this.world, x, z);
        g.fillStyle = terrainColor(getBlock(this.world, x, top, z), top, this.world.sy);
        g.fillRect(x, z, 1, 1);
      }
    }
    return c;
  }

  update(now: number, frame: MinimapFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (now - this.lastVisionAt >= VISION_INTERVAL_MS) {
      this.lastVisionAt = now;
      this.visible = visibleIds(this.world, frame.observers, frame.enemies);
      this.pin = this.trackEnemyFlag(frame);
    }

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(this.terrain, 0, 0, this.w, this.h);
    this.drawBases(ctx, frame.myTeam);

    const enemyBase = this.baseOf(this.enemyTeam(frame.myTeam));
    if (this.pin && enemyBase) {
      const at = this.at(this.pin.x, this.pin.z);
      this.drawFlag(ctx, at, teamColor(this.enemyTeam(frame.myTeam), HOSTILE), this.pin.visible ? 1 : 0.4);
    }
    if (frame.ownFlag) {
      const at = this.at(frame.ownFlag.x, frame.ownFlag.z);
      this.drawFlag(ctx, at, teamColor(frame.myTeam, SELF), 1);
    }

    for (const e of frame.enemies) {
      if (!this.visible.has(e.id)) continue;
      this.drawDot(ctx, this.at(e.pos.x, e.pos.z), teamColor(e.team, HOSTILE));
    }
    for (const m of frame.mates) this.drawDot(ctx, this.at(m.x, m.z), teamColor(m.team, SELF));
    this.drawSelf(ctx, frame);
  }

  /** Line of sight to the flag itself; a flag on its stand is public knowledge. */
  private trackEnemyFlag(frame: MinimapFrame): FlagPin | null {
    const base = this.baseOf(this.enemyTeam(frame.myTeam));
    const flag = frame.enemyFlag;
    if (!base || !flag) return null;
    const at = { x: flag.x, y: flag.y + FLAG_EYE, z: flag.z };
    const seen = frame.observers.some((o) =>
      hasLineOfSight(this.world, { x: o.x, y: o.y + EYE_HEIGHT, z: o.z }, at),
    );
    return updateFlagPin(this.pin, flag, base, seen);
  }

  private enemyTeam(myTeam: number): number {
    return myTeam === TEAM_RED ? TEAM_BLUE : myTeam === TEAM_BLUE ? TEAM_RED : 0;
  }

  private baseOf(team: number): SpawnPoint | null {
    if (!this.bases || (team !== TEAM_RED && team !== TEAM_BLUE)) return null;
    return this.bases[team as Team] ?? null;
  }

  private at(x: number, z: number): { px: number; py: number } {
    return worldToMap(this.world.sx, this.world.sz, this.w, this.h, x, z);
  }

  /** Both flag stands are fixed by the seed, so their outlines are never hidden. */
  private drawBases(ctx: CanvasRenderingContext2D, myTeam: number): void {
    if (!this.bases) return;
    for (const team of [TEAM_RED, TEAM_BLUE] as const) {
      const b = this.bases[team];
      if (!b) continue;
      const { px, py } = this.at(b.x, b.z);
      ctx.save();
      ctx.globalAlpha = team === myTeam ? 0.85 : 0.6;
      ctx.strokeStyle = teamColor(team, SELF);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawDot(ctx: CanvasRenderingContext2D, at: { px: number; py: number }, color: string): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(at.px, at.py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawFlag(
    ctx: CanvasRenderingContext2D,
    at: { px: number; py: number },
    color: string,
    alpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(at.px - 0.5, at.py + 4);
    ctx.lineTo(at.px - 0.5, at.py - 5);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(at.px, at.py - 5);
    ctx.lineTo(at.px + 6, at.py - 2.5);
    ctx.lineTo(at.px, at.py);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawSelf(ctx: CanvasRenderingContext2D, frame: MinimapFrame): void {
    const { px, py } = this.at(frame.self.x, frame.self.z);
    ctx.save();
    ctx.globalAlpha = frame.self.alive ? 1 : 0.4;
    ctx.translate(px, py);
    ctx.rotate(yawToMapAngle(frame.self.yaw));
    ctx.fillStyle = teamColor(frame.myTeam, SELF);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
