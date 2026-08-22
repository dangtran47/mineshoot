const SENSITIVITY = 0.0022;
export const PITCH_LIMIT = Math.PI / 2 - 0.01;
const LOCK_SPIKE_WINDOW_MS = 200;
const LOCK_SPIKE_DELTA = 300;

/**
 * Chrome can fire one bogus, huge movement right after the lock engages; only
 * that short window is filtered. A permanent delta cap would eat legitimate
 * fast flicks on high-DPI mice (they easily exceed 300 counts per event).
 */
export function isLockSpike(msSinceLock: number, dx: number, dy: number): boolean {
  return msSinceLock < LOCK_SPIKE_WINDOW_MS && (Math.abs(dx) > LOCK_SPIKE_DELTA || Math.abs(dy) > LOCK_SPIKE_DELTA);
}

/**
 * Pointer-lock mouse look producing plain yaw/pitch numbers, plus mouse
 * button and wheel events while locked. Chrome refuses to re-lock for ~1s
 * after ESC; callers show a "click to resume" overlay via onLockChange.
 */
export class PointerLook {
  yaw = 0;
  pitch = 0;
  /** Extra multiplier on mouse sensitivity (sniper scope sets 1/zoom so aiming slows with the FOV). */
  sensitivityScale = 1;
  private lockedAt = -Infinity;
  onLockChange: ((locked: boolean) => void) | null = null;
  onMouseDown: ((button: number) => void) | null = null;
  onMouseUp: ((button: number) => void) | null = null;
  onWheel: ((deltaY: number) => void) | null = null;
  /** The yaw/pitch change a mouse move actually applied (post-clamp); recoil compensation tracking. */
  onDelta: ((dYaw: number, dPitch: number) => void) | null = null;

  private readonly onMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    if (isLockSpike(performance.now() - this.lockedAt, e.movementX, e.movementY)) return;
    const s = SENSITIVITY * this.sensitivityScale;
    const prevPitch = this.pitch;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s;
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    this.onDelta?.(-e.movementX * s, this.pitch - prevPitch);
  };
  private readonly onChange = (): void => {
    if (this.locked) this.lockedAt = performance.now();
    this.onLockChange?.(this.locked);
  };
  private readonly onDown = (e: MouseEvent): void => {
    if (this.locked) this.onMouseDown?.(e.button);
  };
  private readonly onUp = (e: MouseEvent): void => {
    if (this.locked) this.onMouseUp?.(e.button);
  };
  private readonly onWheelEv = (e: WheelEvent): void => {
    if (!this.locked) return;
    e.preventDefault();
    this.onWheel?.(e.deltaY);
  };
  private readonly onCtx = (e: Event): void => e.preventDefault();

  constructor(private readonly element: HTMLElement) {
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('pointerlockchange', this.onChange);
    document.addEventListener('mousedown', this.onDown);
    document.addEventListener('mouseup', this.onUp);
    document.addEventListener('wheel', this.onWheelEv, { passive: false });
    element.addEventListener('contextmenu', this.onCtx);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  request(): void {
    try {
      const p = (this.element as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void }).requestPointerLock(
        { unadjustedMovement: true },
      );
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.element.requestPointerLock());
    } catch {
      try {
        this.element.requestPointerLock();
      } catch {
        /* unsupported */
      }
    }
  }

  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('pointerlockchange', this.onChange);
    document.removeEventListener('mousedown', this.onDown);
    document.removeEventListener('mouseup', this.onUp);
    document.removeEventListener('wheel', this.onWheelEv);
    this.element.removeEventListener('contextmenu', this.onCtx);
    this.release();
  }
}
