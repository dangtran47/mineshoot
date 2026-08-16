import { describe, expect, it } from 'vitest';
import { GUN_DAMAGE, HEAD_HALF_W, LEGS_TOP, PLAYER_HALF_W, PLAYER_HEIGHT, TORSO_TOP } from '../src/constants';
import { damageForPart, playerHitboxes } from '../src/hitbox';

describe('playerHitboxes', () => {
  const feet = { x: 10, y: 5, z: 20 };
  const boxes = playerHitboxes(feet);
  const byPart = Object.fromEntries(boxes.map((h) => [h.part, h.box]));

  it('stacks legs, torso and head from the feet up to PLAYER_HEIGHT without gaps', () => {
    expect(boxes.map((b) => b.part)).toEqual(['legs', 'torso', 'head']);
    expect(byPart.legs.min.y).toBe(5);
    expect(byPart.legs.max.y).toBe(5 + LEGS_TOP);
    expect(byPart.torso.min.y).toBe(5 + LEGS_TOP);
    expect(byPart.torso.max.y).toBe(5 + TORSO_TOP);
    expect(byPart.head.min.y).toBe(5 + TORSO_TOP);
    expect(byPart.head.max.y).toBe(5 + PLAYER_HEIGHT);
  });
  it('uses the full body width for legs/torso and a narrower head', () => {
    expect(byPart.legs.max.x - feet.x).toBeCloseTo(PLAYER_HALF_W);
    expect(byPart.torso.min.z).toBeCloseTo(feet.z - PLAYER_HALF_W);
    expect(byPart.head.max.x - feet.x).toBeCloseTo(HEAD_HALF_W);
    expect(HEAD_HALF_W).toBeLessThan(PLAYER_HALF_W);
  });
});

describe('damageForPart', () => {
  it('maps parts to the damage table', () => {
    expect(damageForPart('head')).toBe(GUN_DAMAGE.head);
    expect(damageForPart('torso')).toBe(GUN_DAMAGE.torso);
    expect(damageForPart('legs')).toBe(GUN_DAMAGE.legs);
    expect(GUN_DAMAGE.head).toBe(100);
    expect(GUN_DAMAGE.torso).toBe(30);
    expect(GUN_DAMAGE.legs).toBe(15);
  });
});
