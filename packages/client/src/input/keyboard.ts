/** Tracks held keys by e.code; cleared on blur so keys never stick. */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  private readonly onBlur = (): void => this.clear();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical key press; consumed by this call. */
  wasPressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Call once per frame after processing input. */
  endFrame(): void {
    this.pressed.clear();
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
