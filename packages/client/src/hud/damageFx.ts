import { MAX_HP } from '@mineshoot/shared';

/** Flash opacity for a 1-HP scratch; anything more scales up towards DMG_FLASH_MAX_OPACITY. */
export const DMG_FLASH_MIN_OPACITY = 0.3;
export const DMG_FLASH_MAX_OPACITY = 0.9;
export const DMG_FLASH_MIN_MS = 150;
export const DMG_FLASH_MAX_MS = 600;

export interface DamageFlashParams {
  /** Peak opacity of the screen-edge vignette (0..1). */
  opacity: number;
  /** How long the vignette holds before it fades. */
  durationMs: number;
}

/**
 * How hard the "you got hurt" vignette hits, as a function of HP lost: a leg graze
 * barely tints the edges, a lethal hit paints them solid and lingers.
 */
export function damageFlashParams(damage: number): DamageFlashParams {
  const t = Math.max(0, Math.min(1, damage / MAX_HP));
  return {
    opacity: DMG_FLASH_MIN_OPACITY + (DMG_FLASH_MAX_OPACITY - DMG_FLASH_MIN_OPACITY) * t,
    durationMs: Math.round(DMG_FLASH_MIN_MS + (DMG_FLASH_MAX_MS - DMG_FLASH_MIN_MS) * t),
  };
}
