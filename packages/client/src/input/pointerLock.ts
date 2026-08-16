const SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/**
 * Pointer-lock mouse look producing plain yaw/pitch numbers, plus mouse
 * button and wheel events while locked. Chrome refuses to re-lock for ~1s
 * after ESC; callers show a "click to resume" overlay via onLockChange.
 */
export class PointerLook {
  yaw = 0;
  pitch = 0;
  onLockChange: ((locked: boolean) => void) | null = null;
  onMouseDown: ((button: number) => void) | null = null;
  onMouseUp: ((button: number) => void) | null = null;
  onWheel: ((deltaY: number) => void) | null = null;

  private readonly onMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // Ignore the occasional huge spike right after locking.
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    this.yaw -= e.movementX * SENSITIVITY;
    this.pitch -= e.movementY * SENSITIVITY;
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
  };
  private readonly onChange = (): void => {
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
