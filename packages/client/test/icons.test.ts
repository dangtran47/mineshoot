import { describe, expect, it } from 'vitest';
import { GUN_PISTOL, GUN_SNIPER, GUN_TASER, MELEE_SWORD, WEAPON_GRENADE, WEAPON_PISTOL, WEAPON_PRIMARY } from '@mineshoot/shared';
import { BITMAPS, ICON_SIZE, awardBadges, iconSvg, weaponIcon } from '../src/hud/icons';
import { killTags } from '@mineshoot/shared';

describe('icon bitmaps', () => {
  it('are 16×16 and use only palette characters', () => {
    for (const [name, rows] of Object.entries(BITMAPS)) {
      expect(rows, name).toHaveLength(ICON_SIZE);
      for (const r of rows) {
        expect(r, name).toHaveLength(ICON_SIZE);
        expect(r, name).toMatch(/^[.#kboy]+$/);
      }
      expect(rows.join(''), `${name} is not blank`).not.toMatch(/^\.+$/);
    }
  });
  it('iconSvg merges horizontal runs into rects and tags classes', () => {
    const svg = iconSvg('gun', 'red');
    expect(svg).toMatch(/^<svg class="icon icon-gun red"/);
    expect(svg).toContain('<rect x="2" y="4" width="13" height="1" fill="currentColor"/>');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(iconSvg('sword')).toContain('fill="#8a5a2b"');
  });
  it('weaponIcon maps 0→gun, 1→the melee kind in the slot', () => {
    expect(weaponIcon(0)).toContain('icon-gun');
    expect(weaponIcon(0, 2)).toContain('icon-gun');
    expect(weaponIcon(1)).toContain('icon-sword');
    expect(weaponIcon(1, 1)).toContain('icon-axe');
    expect(weaponIcon(1, 2)).toContain('icon-katana');
    expect(weaponIcon(1, 3)).toContain('icon-scythe');
    expect(weaponIcon(1, 4)).toContain('icon-pickaxe');
    expect(weaponIcon(1, 99)).toContain('icon-sword');
    expect(weaponIcon(WEAPON_PRIMARY, MELEE_SWORD, GUN_SNIPER)).toContain('icon-sniper');
    expect(weaponIcon(WEAPON_PRIMARY, MELEE_SWORD, GUN_TASER)).toContain('icon-taser');
    expect(weaponIcon(WEAPON_GRENADE)).toContain('icon-grenade');
    expect(weaponIcon(WEAPON_PISTOL, MELEE_SWORD, GUN_PISTOL)).toContain('icon-gun');
  });
});

describe('awardBadges', () => {
  it('is empty for a plain kill', () => {
    expect(awardBadges({ multi: 1, streak: 1, revenge: false, shutdown: false })).toEqual([]);
  });
  it('shows one skull per kill (max 5) with a ×N caption', () => {
    const [b] = awardBadges({ multi: 3, streak: 1, revenge: false, shutdown: false });
    expect(b.html.match(/icon-skull/g)).toHaveLength(3);
    expect(b.caption).toBe('×3');
    expect(b.label).toBe('TRIPLE KILL');
    const [big] = awardBadges({ multi: 8, streak: 1, revenge: false, shutdown: false });
    expect(big.html.match(/icon-skull/g)).toHaveLength(5);
    expect(big.caption).toBe('×8');
  });
  it('matches killTags order and labels', () => {
    const a = { multi: 2, streak: 5, revenge: true, shutdown: true };
    expect(awardBadges(a).map((b) => b.label)).toEqual(killTags(a));
    expect(awardBadges(a)[1].html).toContain('icon-revenge red');
    expect(awardBadges(a)[3]).toMatchObject({ caption: '5', label: 'RAMPAGE' });
  });
});
