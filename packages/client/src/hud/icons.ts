/**
 * Pixel-art HUD icons rendered as inline SVG (16×16 grid → <rect> runs). No shipped assets,
 * crisp at any size, and '#' pixels use currentColor so CSS can tint them.
 */
import { GUN_NONE, GUN_PISTOL, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER, GUN_TASER, MELEE_AXE, MELEE_KATANA, MELEE_PICKAXE, MELEE_SCYTHE, MELEE_SWORD, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_TASER, multiKillLabel, streakLabel } from '@mineshoot/shared';
import type { GunKind, KillAwards, MeleeKind } from '@mineshoot/shared';

export const ICON_SIZE = 16;

/** Pixel palette: '.' transparent, '#' currentColor, others fixed. */
const PALETTE: Record<string, string> = {
  '#': 'currentColor',
  k: '#1b1f2a', // dark (eye sockets, outlines)
  b: '#8a5a2b', // wood / grip
  o: '#ff8c1a', // flame outer
  y: '#ffd23f', // flame core
};

export type IconName = 'gun' | 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'taser' | 'grenade' | 'sword' | 'axe' | 'katana' | 'scythe' | 'pickaxe' | 'headshot' | 'skull' | 'flame' | 'revenge' | 'shutdown';

// prettier-ignore
export const BITMAPS: Record<IconName, string[]> = {
  gun: [
    '................',
    '................',
    '................',
    '................',
    '..#############.',
    '.##############.',
    '.##############.',
    '.####.####......',
    '.####..#........',
    '.####..##.......',
    '.####...........',
    '..####..........',
    '..####..........',
    '................',
    '................',
    '................',
  ],
  rifle: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '#..#############',
    '################',
    'bbb#############',
    '.bbb#.####......',
    '..bb..####......',
    '......####......',
    '......####......',
    '................',
    '................',
    '................',
    '................',
  ],
  smg: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...#############',
    '..##############',
    '..####.####.....',
    '..####..###.....',
    '........###.....',
    '........###.....',
    '........###.....',
    '................',
    '................',
    '................',
  ],
  shotgun: [
    '................',
    '................',
    '................',
    '................',
    '....############',
    'bbb#############',
    'bb##############',
    'bbb#############',
    '.bb...bbbb......',
    '......bbbb......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  sniper: [
    '................',
    '................',
    '................',
    '.....kkkk.......',
    '.....k##k.......',
    '################',
    'b###############',
    'bbb#############',
    '..bbb.####..#...',
    '....b.####..#...',
    '......####......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  taser: [
    '................',
    '................',
    '................',
    '................',
    '....yyyyyyyy.##.',
    '....yyyyyyyy##..',
    '....yyyy...##...',
    '....yyyy..##....',
    '....yyyy.####...',
    '.....yyy...##...',
    '.....yyy..##....',
    '..........#.....',
    '................',
    '................',
    '................',
    '................',
  ],
  grenade: [
    '................',
    '................',
    '......kkk.......',
    '......kkk.##....',
    '....#######.....',
    '...#########....',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '...#########....',
    '....#######.....',
    '................',
    '................',
    '................',
  ],
  sword: [
    '.............##.',
    '............###.',
    '...........###..',
    '..........###...',
    '.........###....',
    '........###.....',
    '.......###......',
    '..b...###.......',
    '...b.###........',
    '....###.........',
    '...bbb#.........',
    '..bb..bb........',
    '.bb.....b.......',
    'bb..............',
    '................',
    '................',
  ],
  axe: [
    '..........####..',
    '.........######.',
    '........###..###',
    '........###...##',
    '.......####.....',
    '.......#####....',
    '......bb#####...',
    '.....bb..#####..',
    '....bb....###...',
    '...bb...........',
    '..bb............',
    '.bb.............',
    'bb..............',
    '................',
    '................',
    '................',
  ],
  katana: [
    '..............##',
    '.............##.',
    '............##..',
    '...........##...',
    '..........##....',
    '.........##.....',
    '........##......',
    '.......##.......',
    '......##........',
    '....k###........',
    '...kk#k.........',
    '..kk............',
    '.kk.............',
    'kk..............',
    '................',
    '................',
  ],
  scythe: [
    '......#####.....',
    '....#########...',
    '...####...####..',
    '..###.......###.',
    '..##.........##.',
    '..bb............',
    '..bb............',
    '..bb............',
    '..bb............',
    '..bb............',
    '..bb............',
    '..bb............',
    '..bb............',
    '..bb............',
    '................',
    '................',
  ],
  pickaxe: [
    '.......#######..',
    '.....#########..',
    '....###....####.',
    '...##.....b.###.',
    '..##.....b...##.',
    '.##.....b.......',
    '.......b........',
    '......b.........',
    '.....b..........',
    '....b...........',
    '...b............',
    '..b.............',
    '.b..............',
    'b...............',
    '................',
    '................',
  ],
  headshot: [
    '.......##.......',
    '.......##.......',
    '.....######.....',
    '....##.##.##....',
    '...#...##...#...',
    '...#........#...',
    '..#..........#..',
    '###....##....###',
    '###....##....###',
    '..#..........#..',
    '...#........#...',
    '...#...##...#...',
    '....##.##.##....',
    '.....######.....',
    '.......##.......',
    '.......##.......',
  ],
  skull: [
    '................',
    '.....######.....',
    '....########....',
    '...##########...',
    '...##########...',
    '...#kk####kk#...',
    '...#kk####kk#...',
    '...##########...',
    '....##k##k##....',
    '....########....',
    '.....######.....',
    '.....#k##k#.....',
    '.....######.....',
    '................',
    '................',
    '................',
  ],
  flame: [
    '................',
    '.......o........',
    '......oo........',
    '......ooo.......',
    '.....oooo...o...',
    '.....ooooo.oo...',
    '....oooooo.oo...',
    '....ooooooooo...',
    '...ooooyoooooo..',
    '...oooyyyooooo..',
    '...ooyyyyyoooo..',
    '...ooyyyyyyooo..',
    '....oyyyyyyoo...',
    '....ooyyyyooo...',
    '.....oooooooo...',
    '......oooooo....',
  ],
  revenge: [
    '##...........##.',
    '###.........###.',
    '.###.......###..',
    '..###.....###...',
    '...###...###....',
    '....###.###.....',
    '.....#####......',
    '......###.......',
    '.....#####......',
    '....###.###.....',
    '...###...###....',
    '..###.....###...',
    '.###.......###..',
    'bbb.........bbb.',
    'bb...........bb.',
    '................',
  ],
  shutdown: [
    '................',
    '.############...',
    '.#####.#######..',
    '.#####.#######..',
    '.####.########..',
    '.####.########..',
    '.#####.#######..',
    '.#####.#######..',
    '..####.######...',
    '..###.#######...',
    '...##.######....',
    '...###.####.....',
    '....##.###......',
    '.....#.##.......',
    '......#.........',
    '................',
  ],
};

/** SVG markup for one icon; `cls` adds CSS classes next to `icon icon-<name>`. */
export function iconSvg(name: IconName, cls = ''): string {
  const rows = BITMAPS[name];
  const rects: string[] = [];
  for (let y = 0; y < ICON_SIZE; y++) {
    const row = rows[y];
    let x = 0;
    while (x < ICON_SIZE) {
      const c = row[x];
      if (c === '.') {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < ICON_SIZE && row[x + w] === c) w++;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${PALETTE[c]}"/>`);
      x += w;
    }
  }
  const classes = ['icon', `icon-${name}`, cls].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" shape-rendering="crispEdges" aria-label="${name}" role="img">${rects.join('')}</svg>`;
}

const MELEE_ICONS: Record<MeleeKind, IconName> = {
  [MELEE_SWORD]: 'sword',
  [MELEE_AXE]: 'axe',
  [MELEE_KATANA]: 'katana',
  [MELEE_SCYTHE]: 'scythe',
  [MELEE_PICKAXE]: 'pickaxe',
};

/** Icon name for a melee kind. */
export function meleeIconName(melee: number): IconName {
  return MELEE_ICONS[melee as MeleeKind] ?? 'sword';
}

const GUN_ICONS: Record<GunKind, IconName> = {
  [GUN_NONE]: 'gun',
  [GUN_PISTOL]: 'gun',
  [GUN_RIFLE]: 'rifle',
  [GUN_SMG]: 'smg',
  [GUN_SHOTGUN]: 'shotgun',
  [GUN_SNIPER]: 'sniper',
  [GUN_TASER]: 'taser',
};

/** Icon name for a gun kind. */
export function gunIconName(gun: number): IconName {
  return GUN_ICONS[gun as GunKind] ?? 'gun';
}

/** Weapon icon by slot: melee → its kind, grenade → the grenade, taser → the taser, gun slots → the gun kind held. */
export function weaponIcon(weapon: number, melee: number = MELEE_SWORD, gun: number = GUN_NONE, cls = ''): string {
  if (weapon === WEAPON_MELEE) return iconSvg(meleeIconName(melee), cls);
  if (weapon === WEAPON_GRENADE) return iconSvg('grenade', cls);
  if (weapon === WEAPON_TASER) return iconSvg('taser', cls);
  return iconSvg(gunIconName(gun), cls);
}

/** One badge per award: the icon(s) plus a short caption ("×3", "5", "revenge"...). */
export interface AwardBadge {
  /** SVG markup, possibly several icons concatenated. */
  html: string;
  /** Short caption shown next to / under the icon. */
  caption: string;
  /** Full text label (for tooltips / accessibility). */
  label: string;
}

const MAX_SKULLS = 5;

/** Badges for a kill's awards, most important first (empty for a plain kill). Order matches killTags. */
export function awardBadges(a: KillAwards): AwardBadge[] {
  const out: AwardBadge[] = [];
  const multi = multiKillLabel(a.multi);
  if (multi) {
    const n = Math.min(a.multi, MAX_SKULLS);
    out.push({ html: iconSvg('skull').repeat(n), caption: `×${a.multi}`, label: multi });
  }
  if (a.revenge) out.push({ html: iconSvg('revenge', 'red'), caption: '', label: 'REVENGE' });
  if (a.shutdown) out.push({ html: iconSvg('shutdown'), caption: '', label: 'SHUTDOWN' });
  const streak = streakLabel(a.streak);
  if (streak) out.push({ html: iconSvg('flame'), caption: String(a.streak), label: streak });
  return out;
}
