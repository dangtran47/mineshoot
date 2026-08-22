import * as THREE from 'three';
import {
  EYE_HEIGHT,
  CROUCH_SPEED_SCALE,
  FLAG_CARRY_SPEED_SCALE,
  GRENADE_MAX,
  GUN_NONE,
  GUN_PISTOL,
  GUN_TASER,
  MSG,
  PLAYER_HEIGHT,
  POSE_INTERVAL_MS,
  MELEE_KINDS,
  MELEE_SWORD,
  PRIMARY_KINDS,
  TD_FREEZE_MS,
  TD_INTERMISSION_MS,
  TEAM_BLUE,
  TEAM_NONE,
  TEAM_RED,
  WEAPONS,
  WEAPON_GRENADE,
  WEAPON_MELEE,
  WEAPON_PISTOL,
  WEAPON_PRIMARY,
  WEAPON_TASER,
  allowedWeapons,
  attackSpec,
  dropName,
  forwardVector,
  generateWorldFor,
  gunSpec,
  isCtf,
  isTd,
  isTeam,
  isTeamMode,
  meleeSelectable,
  meleeStats,
  otherTeam,
  rankCtf,
  rankPlayers,
  raycastVoxels,
  recoilKick,
  respawnMsFor,
  teamName,
  weaponAllowed,
} from '@mineshoot/shared';
import type { AttackKind, DropSlot, ExplodeMsg, FlagEventMsg, GunKind, HitMsg, KillMsg, MeleeKind, PickupMsg, PoseMsg, RankRow, RoomMode, RoundEventMsg, SelectWeaponMsg, ShootMsg, ShotMsg, SwingMsg, SwungMsg, Team, ThrowMsg, Vec3, Weapon } from '@mineshoot/shared';
import { displayName } from '../net';
import type { GameRoom, NetFlag, NetPlayer } from '../net';
import { FlagsView } from '../render/flagsView';
import { createScene } from '../render/scene';
import { buildWorldMeshes } from '../render/worldMesh';
import { Tracers } from '../render/tracers';
import { BloodFx } from '../render/bloodFx';
import { BulletHoles, bulletHoleAt } from '../render/bulletHoles';
import { DropsView } from '../render/dropsView';
import { GrenadesView } from '../render/grenadesView';
import { ViewModel } from '../render/viewmodel';
import { Keyboard } from '../input/keyboard';
import { PointerLook } from '../input/pointerLock';
import { LocalPlayer } from '../game/localPlayer';
import { RecoilController } from '../game/recoil';
import { RemotePlayers } from '../game/remotePlayers';
import { cycleTarget, eligibleTargets, retainTarget, spectateLoadout, spectateReady } from '../game/spectateModel';
import type { SpectateCandidate } from '../game/spectateModel';
import { Weapons } from '../game/weapons';
import { Hud } from '../hud/hud';
import { Minimap } from '../hud/minimap';
import type { MapDot } from '../game/minimapModel';
import { awardBadges } from '../hud/icons';

/** Keys 6–0 pick a melee weapon directly where the room allows it (training range, offline sandbox). */
const MELEE_PICK_KEYS: readonly string[] = ['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
/** Z X C V N pick a primary gun, B the taser, directly (training range, offline sandbox). */
const PRIMARY_PICK_KEYS: readonly string[] = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyN'];

/** Team-mode outcome handed to the results screen: captures (ctf) or round wins (td). */
export interface TeamSummary {
  mode: 'ctf' | 'td';
  redScore: number;
  blueScore: number;
  /** Captures (ctf) / round wins (td) needed to take the match. */
  captureLimit: number;
}

export interface GameScreenOptions {
  container: HTMLElement;
  /** null = offline sandbox (no networking). */
  room: GameRoom | null;
  seed: number;
  onEnded(ranking: RankRow[], meId: string, roomName: string, team?: TeamSummary): void;
  onLeft(message: string): void;
}

/** Composes world, local/remote players, weapons, HUD and the network loop. */
export function startGame(opts: GameScreenOptions): { dispose(): void } {
  const { container, room } = opts;
  const meId = room?.sessionId ?? 'me';
  const weaponMode = room?.state.weapons ?? 'all';
  // The offline sandbox behaves like a training range (every melee weapon is a key away).
  const roomMode: RoomMode = room?.state.mode ?? 'training';
  const ctf = isCtf(roomMode);
  const td = isTd(roomMode);
  const teamMode = isTeamMode(roomMode);
  const { world, spawnPoints, bases } = generateWorldFor(roomMode, opts.seed);

  const bundle = createScene(container);
  const { scene, camera, renderer } = bundle;
  const baseFov = camera.fov;
  const worldMesh = buildWorldMeshes(world);
  scene.add(worldMesh.group);
  const tracers = new Tracers();
  scene.add(tracers.group);
  const blood = new BloodFx();
  scene.add(blood.mesh);
  const bulletHoles = new BulletHoles();
  scene.add(bulletHoles.mesh);
  const remotes = new RemotePlayers();
  scene.add(remotes.group);
  const drops = new DropsView();
  scene.add(drops.group);
  const grenades = new GrenadesView();
  scene.add(grenades.group);
  const flags = new FlagsView();
  scene.add(flags.group);
  scene.add(camera); // so the view model (child of camera) renders
  const viewModel = new ViewModel(camera);

  const keys = new Keyboard();
  const look = new PointerLook(renderer.domElement);
  const recoil = new RecoilController(look);
  const hud = new Hud(container);
  const minimap = new Minimap(hud.root, world, teamMode ? bases : null);

  const meNet = (): NetPlayer | undefined => room?.state.players.get(meId);
  const initial = meNet();
  const spawn = initial ?? { x: spawnPoints[0].x, y: spawnPoints[0].y, z: spawnPoints[0].z, yaw: 0 };
  const local = new LocalPlayer(world, camera, keys, look, spawn.x, spawn.y, spawn.z, spawn.yaw);
  let epoch = initial?.spawnEpoch ?? 1;
  let diedAt = 0;
  /** While dead: the player whose eyes we are watching through, or null (own death cam). */
  let spectateTarget: string | null = null;
  let ended = false;
  /** TD: no moving or attacking until this time after a spawn (the 3-2-1 countdown). */
  let frozenUntil = 0;
  let freezeCount = 0;
  /** CTF: the flag we carry (its owning team), or null. */
  let carrying: Team | null = null;
  const allowed = allowedWeapons(weaponMode);
  const canPickMelee = meleeSelectable(roomMode, weaponMode);
  const canPickPrimary = roomMode === 'training' && weaponAllowed(weaponMode, WEAPON_PRIMARY);
  hud.setRoomName(room ? (roomMode === 'training' ? `\u{1F3AF} ${room.state.name}` : ctf ? `\u{1F6A9} ${room.state.name}` : td ? `⚔️ ${room.state.name}` : room.state.name) : 'Offline sandbox');
  hud.setWeaponRules(weaponMode, roomMode);
  if (td) hud.setTimerVisible(false);

  // --- weapons ---
  /** Ctrl/C held this frame; read by the frame loop and sent on every pose-like message. */
  let crouching = false;
  const currentPose = (): Omit<ThrowMsg, 'charge'> => ({
    x: local.state.x,
    y: local.state.y,
    z: local.state.z,
    yaw: look.yaw,
    pitch: look.pitch,
    epoch,
    crouch: crouching,
  });
  const muzzle = (): THREE.Vector3 => {
    // The view model's actual barrel tip; the hand-tuned offset only covers slots with no gun out.
    const tip = viewModel.muzzleWorld(new THREE.Vector3());
    if (tip) return tip;
    const f = forwardVector(look.yaw, look.pitch);
    const right = new THREE.Vector3(Math.cos(look.yaw), 0, -Math.sin(look.yaw));
    return new THREE.Vector3(local.state.x, local.state.y + EYE_HEIGHT, local.state.z)
      .addScaledVector(right, 0.25)
      .add(new THREE.Vector3(0, -0.18, 0))
      .addScaledVector(new THREE.Vector3(f.x, f.y, f.z), 0.5);
  };
  /** Weapon panel writer that yields to the spectate view: while watching somebody, their loadout owns the HUD. */
  const setHudWeapon = (w: Weapon, melee: MeleeKind, gun: GunKind): void => {
    if (spectateTarget === null) hud.setWeapon(w, melee, gun);
  };
  const weapons = new Weapons({
    onFire(slot: Weapon) {
      const kind: GunKind = slot === WEAPON_PRIMARY ? weapons.gun : slot === WEAPON_TASER ? weapons.taser : GUN_PISTOL;
      viewModel.fire(0.55 + recoilKick(kind, 0).pitchDeg * 0.28);
      if (room) {
        const m: ShootMsg = { ...currentPose(), weapon: slot };
        room.send(MSG.shoot, m);
      } else {
        // No server to hitscan for us: walk the ray locally so the tracer stops at the wall
        // and leaves a hole there.
        const f = forwardVector(look.yaw, look.pitch);
        const m = muzzle();
        const eye = { x: local.state.x, y: local.state.y + EYE_HEIGHT, z: local.state.z };
        const voxel = raycastVoxels(world, eye, f, 40);
        const to = voxel.hit ? voxel.point : { x: eye.x + f.x * 40, y: eye.y + f.y * 40, z: eye.z + f.z * 40 };
        tracers.spawn(m, to);
        if (voxel.hit) {
          const hole = bulletHoleAt(world, eye, to);
          if (hole) bulletHoles.spawn(hole.point, hole.normal, performance.now());
        }
      }
      // Kick after the shot is on the wire: the recoil pattern bends the *next* bullet.
      recoil.kick(kind, performance.now());
    },
    onThrow(charge: number) {
      viewModel.throwAnim();
      const m: ThrowMsg = { ...currentPose(), charge };
      room?.send(MSG.throw, m);
    },
    onChargeStart() {
      room?.send(MSG.charge, epoch);
    },
    onChargeCancel() {
      room?.send(MSG.chargeCancel, epoch);
    },
    onSwing(attack: AttackKind) {
      viewModel.swing(attackSpec(weapons.melee, attack).anim);
      const m: SwingMsg = { ...currentPose(), attack };
      room?.send(MSG.swing, m);
    },
    onSwitch(w: Weapon) {
      viewModel.setWeapon(w);
      setHudWeapon(w, weapons.melee, weapons.gun);
    },
    onReload(slot: Weapon) {
      room?.send(MSG.reload, { epoch, weapon: slot });
    },
    onMeleeChange(kind: MeleeKind) {
      viewModel.setMelee(kind);
      setHudWeapon(weapons.current, kind, weapons.gun);
    },
    onGunChange(kind: GunKind) {
      viewModel.setGun(kind);
      setHudWeapon(weapons.current, weapons.melee, kind);
    },
    onTaserChange() {
      setHudWeapon(weapons.current, weapons.melee, weapons.gun);
    },
    onPistolChange() {
      setHudWeapon(weapons.current, weapons.melee, weapons.gun);
    },
    onGrenadesChange(n: number) {
      if (spectateTarget === null) hud.setGrenades(n);
    },
  }, allowed);
  /** Put our own loadout back on the HUD; the spectate view overwrites these panels while we watch somebody. */
  const showOwnLoadout = (): void => {
    hud.setWeapon(weapons.current, weapons.melee, weapons.gun);
    hud.setGrenades(weapons.grenades);
    const me = meNet();
    if (me) {
      hud.setHealth(me.hp);
      hud.setShield(me.alive && me.shielded);
    }
  };
  viewModel.setWeapon(weapons.current);
  showOwnLoadout();
  /** Training range / sandbox: arm `kind` in the melee slot and bring it out (the server confirms via the state patch). */
  const pickMelee = (kind: MeleeKind): void => {
    if (!canPickMelee || !local.alive) return;
    if (room) {
      const m: SelectWeaponMsg = { epoch, slot: WEAPON_MELEE, kind };
      room.send(MSG.selectWeapon, m);
    } else {
      weapons.setMelee(kind);
    }
    weapons.select(WEAPON_MELEE);
    hud.toast(meleeStats(kind).name);
  };
  /** Training range / sandbox: arm a primary gun (or the taser, into its own slot) directly. */
  const pickPrimary = (kind: GunKind): void => {
    if (!canPickPrimary || !local.alive) return;
    const slot = kind === GUN_TASER ? WEAPON_TASER : WEAPON_PRIMARY;
    if (room) {
      const m: SelectWeaponMsg = { epoch, slot, kind };
      room.send(MSG.selectWeapon, m);
    } else if (kind === GUN_TASER) {
      weapons.setTaser(kind);
    } else {
      weapons.setGun(kind);
    }
    weapons.select(slot);
    hud.toast(gunSpec(kind).name);
  };

  // --- spectate (dead players watch somebody else's first-person view) ---
  const spectateCandidates = (): SpectateCandidate[] => {
    const list: SpectateCandidate[] = [];
    room?.state.players.forEach((p, id) => list.push({ id, alive: p.alive, team: p.team }));
    return list;
  };
  const spectateEligible = (): string[] => eligibleTargets(spectateCandidates(), meId, teamMode, meNet()?.team ?? TEAM_NONE);
  /** Move the spectate camera to `next` (null = back to our own death cam) and dress the view for it. */
  const setSpectateTarget = (next: string | null): void => {
    if (next === spectateTarget) return;
    if (spectateTarget) remotes.setHidden(spectateTarget, false);
    if (next) remotes.setHidden(next, true);
    spectateTarget = next;
    viewModel.setHidden(next !== null);
    // Back on our own death cam: the frame loop stops writing somebody else's health/weapon, so restore ours.
    if (next === null) showOwnLoadout();
    const p = next ? room?.state.players.get(next) : undefined;
    hud.setSpectating(p ? displayName(p.name, p.isBot) : null);
    // Spectating is a live view: full colors, no death banner — only the name label above.
    // Back on the own death cam (nobody watchable) both come back.
    if (!local.alive && epoch > 0) {
      renderer.domElement.classList.toggle('dead', next === null);
      if (next === null) hud.unhideDeath();
      else hud.hideDeath();
    }
  };

  // --- input wiring ---
  look.onMouseDown = (b) => {
    // Dead: the mouse cycles who we are watching instead of firing.
    if (!local.alive && spectateTarget !== null) {
      if (b === 0 || b === 2) setSpectateTarget(cycleTarget(spectateEligible(), spectateTarget, b === 0 ? 1 : -1));
      return;
    }
    if (!local.alive || (td && performance.now() < frozenUntil)) return;
    if (b === 0) weapons.mouseDown(performance.now());
    else if (b === 2) weapons.altDown(performance.now());
  };
  look.onMouseUp = (b) => {
    if (b === 0) weapons.mouseUp(performance.now());
    else if (b === 2) weapons.altUp(performance.now());
  };
  look.onWheel = (deltaY) => {
    if (local.alive) weapons.next(deltaY > 0 ? 1 : -1);
  };
  // "Click to play": the server spawns us only once we have locked the pointer for the first time,
  // so nobody can be hurt while still staring at the overlay. Later re-locks (after Esc) don't re-arm it.
  let readySent = false;
  const sendReady = (): void => {
    if (readySent) return;
    readySent = true;
    room?.send(MSG.ready);
  };
  look.onLockChange = (locked) => {
    hud.setOverlay(!locked);
    if (locked) sendReady();
    else {
      keys.clear();
      weapons.cancel();
    }
  };
  hud.onOverlayClick = () => look.request();
  hud.onSelectTeam = (team) => room?.send(MSG.selectTeam, team);
  hud.onLeave = () => {
    if (ended) return;
    ended = true;
    finish();
    if (room) void room.leave();
    opts.onLeft(room ? 'You left the match' : 'Left the sandbox');
  };
  hud.setOverlay(true);

  // --- networking ---
  const knownIds = new Set<string>();
  let lastTimeLeft = room?.state.timeLeftMs ?? 0;
  let lastTimeLeftAt = performance.now();
  let rtt: number | null = null;

  const rankingRows = (): RankRow[] => {
    const rows: RankRow[] = [];
    room?.state.players.forEach((p, id) => rows.push({ id, name: p.name, kills: p.kills, deaths: p.deaths, assists: p.assists, isBot: p.isBot, team: p.team, captures: p.captures, alive: p.alive }));
    // rankCtf with all-zero captures (td) sorts by kills, which is what we want.
    return teamMode ? rankCtf(rows) : rankPlayers(rows);
  };
  const teamSummary = (): TeamSummary | undefined => {
    if (!room || !teamMode) return undefined;
    return td
      ? { mode: 'td', redScore: room.state.roundsRed, blueScore: room.state.roundsBlue, captureLimit: room.state.roundLimit }
      : { mode: 'ctf', redScore: room.state.redScore, blueScore: room.state.blueScore, captureLimit: room.state.captureLimit };
  };
  const flagOf = (team: Team): NetFlag | undefined => room?.state.flags?.get(String(team));

  const onPatch = (): void => {
    if (!room || ended) return;
    const now = performance.now();
    const state = room.state;
    // Diff players: add new remotes, drop departed ones, feed snapshots.
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      if (id === meId) return;
      if (!knownIds.has(id)) {
        knownIds.add(id);
        remotes.add(id, p);
      }
      remotes.snapshot(id, p, now);
    });
    for (const id of [...knownIds]) {
      if (!seen.has(id)) {
        knownIds.delete(id);
        remotes.remove(id);
      }
    }
    // Own player: server-dictated spawns and death.
    const me = state.players.get(meId);
    if (me) {
      if (me.spawnEpoch !== epoch) {
        epoch = me.spawnEpoch;
        local.teleport(me.x, me.y, me.z, me.yaw);
        local.alive = true;
        if (td) frozenUntil = now + TD_FREEZE_MS;
        weapons.resetAmmo();
        // Gun-deathmatch spawn roll: arm the rolled primary from this patch (the slot sync below
        // runs too late — death cleared the local slot) and bring it out right away.
        weapons.setGun(me.gun as GunKind);
        if (weapons.gun !== GUN_NONE) weapons.select(WEAPON_PRIMARY);
        hud.hideDeath();
        setSpectateTarget(null); // back in our own body: unhide whoever we watched, hands back on
        renderer.domElement.classList.remove('dead');
      } else if (!me.alive && local.alive) {
        // Either killed, or (epoch 0) not yet spawned because we haven't clicked to play.
        local.alive = false;
        diedAt = epoch > 0 ? now : 0;
        weapons.cancel();
        // Grey out the world while dead (not on the initial click-to-play overlay).
        renderer.domElement.classList.toggle('dead', epoch > 0);
      }
      // Weapon slots follow the server (drop pickups arm them, death resets them).
      weapons.setMelee(me.melee as MeleeKind);
      weapons.setPistol(me.pistol as GunKind);
      weapons.setGun(me.gun as GunKind);
      weapons.setTaser(me.taser as GunKind);
      weapons.setGrenades(me.grenades);
      hud.setStats(me.kills, me.assists, me.deaths);
      if (spectateTarget === null) {
        hud.setHealth(me.hp);
        hud.setShield(me.alive && me.shielded);
      }
      if (teamMode) {
        // Team buttons on the overlay (also lets an unspawned player pick a side; the camera follows the new side).
        const counts: Record<Team, number> = { [TEAM_RED]: 0, [TEAM_BLUE]: 0 };
        state.players.forEach((p) => {
          if (isTeam(p.team)) counts[p.team]++;
        });
        hud.setTeams(isTeam(me.team) ? me.team : 0, counts);
        if (me.spawnEpoch === 0 && !local.alive) local.teleport(me.x, me.y, me.z, me.yaw);
      }
    }
    if (td) hud.setTdScore(state.roundsRed, state.roundsBlue, state.roundLimit, state.round);
    if (ctf) {
      // Carrying a flag: melee only, slower (see the frame loop), banner + G hint.
      let mine: Team | null = null;
      state.flags?.forEach((f) => {
        if (f.status === 'carried' && f.carrierId === meId && isTeam(f.team)) mine = f.team;
      });
      if (mine !== carrying) {
        carrying = mine;
        weapons.setLockedToMelee(carrying !== null);
        hud.setCarrying(carrying);
      }
      const red = flagOf(TEAM_RED);
      const blue = flagOf(TEAM_BLUE);
      if (red && blue) hud.setCtfScore(state.redScore, state.blueScore, state.captureLimit, red.status, blue.status);
    }
    // Weapon drops on the ground; live grenades in the air.
    const dropIds = new Set<string>();
    state.drops?.forEach((d, id) => {
      dropIds.add(id);
      if (!drops.has(id)) drops.add(id, d.slot as Weapon, d.kind, d.x, d.y, d.z);
    });
    drops.retain(dropIds);
    grenades.sync(state.grenades);
    if (state.timeLeftMs !== lastTimeLeft) {
      lastTimeLeft = state.timeLeftMs;
      lastTimeLeftAt = now;
    }
    if (state.phase === 'ended') {
      ended = true;
      finish();
      opts.onEnded(rankingRows(), meId, state.name, teamSummary());
    }
  };

  /** TD: a round started or ended → big banner + feed line; the end time drives the intermission countdown. */
  let roundEndedAt = 0;
  const onRound = (m: RoundEventMsg): void => {
    const score = `${m.roundsRed} – ${m.roundsBlue}`;
    if (m.kind === 'end') {
      roundEndedAt = performance.now();
      const text = m.winner === TEAM_NONE ? `Round ${m.round}: a draw — nobody scores` : `${teamName(m.winner as Team)} takes round ${m.round}!  ${score}`;
      const myTeam = room?.state.players.get(meId)?.team;
      hud.roundBanner(text, 2800);
      hud.pushFeedText(`⚔️ ${text}`, m.winner === TEAM_NONE || myTeam === undefined ? 'neutral' : m.winner === myTeam ? 'good' : 'bad');
    } else {
      // The post-spawn 3-2-1 countdown announces the new round.
      roundEndedAt = 0;
    }
  };

  /** CTF flag events → feed line (+ toast on a capture). Colour by whose team acted. */
  const onFlag = (m: FlagEventMsg): void => {
    if (!room) return;
    const myTeam = room.state.players.get(meId)?.team;
    const actor = room.state.players.get(m.playerId);
    const actorName = actor ? displayName(actor.name, actor.isBot) : m.playerName;
    const flag = `${teamName(m.team)} flag`;
    const actorTeam = actor?.team;
    let text: string;
    switch (m.kind) {
      case 'taken':
        text = actorTeam === m.team ? `\u{1F6A9} ${actorName} picked up the ${flag}` : `\u{1F6A9} ${actorName} took the ${flag}`;
        break;
      case 'dropped':
        text = `\u{1F6A9} ${actorName} dropped the ${flag}`;
        break;
      case 'returned':
        text = actorName ? `\u{1F6A9} ${actorName} returned the ${flag}` : `\u{1F6A9} The ${flag} returned home`;
        break;
      default:
        text = `\u{1F6A9} ${actorName} captured the ${flag}! ${m.redScore} \u2013 ${m.blueScore}`;
    }
    const kind = actorTeam === undefined || myTeam === undefined ? 'neutral' : actorTeam === myTeam ? 'good' : 'bad';
    hud.pushFeedText(text, kind);
    if (m.kind === 'captured') hud.toast(`${teamName(otherTeam(m.team))} scores! ${m.redScore} \u2013 ${m.blueScore}`, 3000);
  };

  const onShot = (m: ShotMsg): void => {
    // Start tracers at the rendered gun tip, not the shooter's eye; the server's `from` is the fallback.
    const from = m.shooterId === meId ? muzzle() : remotes.muzzleWorld(m.shooterId) ?? m.from;
    let hitMe = 0;
    let hitOther = false;
    let head = false;
    for (const r of m.rays) {
      tracers.spawn(from, r.to, m.shooterId === meId ? 0xfff2a8 : 0xffb46b);
      if (r.hitPlayerId === meId) {
        hitMe += r.damage;
      } else if (r.hitPlayerId) {
        hitOther = true;
        head ||= r.part === 'head';
        blood.burst(r.to, r.damage, { x: r.to.x - from.x, y: r.to.y - from.y, z: r.to.z - from.z });
      } else {
        // Nobody was hit: the ray may have ended on a wall. Re-walk it from the server's origin
        // (not the cosmetic muzzle above) to recover the block face and mark it.
        const hole = bulletHoleAt(world, m.from, r.to);
        if (hole) bulletHoles.spawn(hole.point, hole.normal, performance.now());
      }
    }
    if (m.shooterId === meId && hitOther) hud.hitmark(head);
    if (hitMe > 0) hud.damageFlash(hitMe);
    if (m.shooterId !== meId) remotes.shot(m.shooterId, performance.now());
  };
  /** A grenade burst: flash + spray on every victim; damage feedback like a shot. */
  const onExplode = (m: ExplodeMsg): void => {
    grenades.burst(m, performance.now());
    const mine = m.victims.find((v) => v.id === meId);
    if (mine) hud.damageFlash(mine.damage);
    if (m.ownerId === meId && m.victims.some((v) => v.id !== meId)) hud.hitmark(false);
    for (const v of m.victims) {
      const at = v.id === meId ? null : remotes.position(v.id);
      if (at) blood.burst({ x: at.x, y: at.y + PLAYER_HEIGHT * 0.55, z: at.z }, v.damage, { x: at.x - m.x, y: 0.5, z: at.z - m.z });
    }
  };
  const onSwung = (m: SwungMsg): void => {
    if (m.attackerId !== meId) remotes.swing(m.attackerId, m.attack, m.melee, performance.now());
  };
  const onPickup = (m: PickupMsg): void => {
    if (m.playerId !== meId) return;
    // Arm it right away (the state patch will confirm) and bring it out if the room allows.
    if (m.slot === WEAPON_MELEE) {
      weapons.setMelee(m.kind as MeleeKind);
      weapons.select(WEAPON_MELEE);
    } else if (m.slot === WEAPON_PRIMARY) {
      weapons.setGun(m.kind as GunKind);
      weapons.select(WEAPON_PRIMARY);
    } else if (m.slot === WEAPON_TASER) {
      weapons.setTaser(m.kind as GunKind);
      weapons.select(WEAPON_TASER);
    } else if (m.slot === WEAPON_PISTOL) {
      weapons.setPistol(m.kind as GunKind);
      // Already holding a primary: pocket the pistol without switching to it.
      if (weapons.gun === GUN_NONE) weapons.select(WEAPON_PISTOL);
    } else {
      weapons.setGrenades(Math.min(GRENADE_MAX, weapons.grenades + m.kind));
    }
    hud.toast(`Picked up ${dropName({ slot: m.slot as DropSlot, kind: m.kind })}`);
  };
  const onHit = (m: HitMsg): void => {
    if (m.attackerId === meId) hud.hitmark(m.part === 'head');
    if (m.victimId === meId) hud.damageFlash(m.damage);
    // Sword hits carry no impact point: spray from the victim's rendered body, away from the attacker.
    const victim = m.victimId === meId ? null : remotes.position(m.victimId);
    if (victim) {
      const attacker = m.attackerId === meId ? local.state : remotes.position(m.attackerId);
      const wound = { x: victim.x, y: victim.y + (m.part === 'head' ? PLAYER_HEIGHT * 0.9 : PLAYER_HEIGHT * 0.55), z: victim.z };
      const dir = attacker ? { x: victim.x - attacker.x, y: 0, z: victim.z - attacker.z } : { x: 0, y: 1, z: 0 };
      blood.burst(wound, m.damage, dir);
    }
  };
  const onKill = (m: KillMsg): void => {
    const mine = m.killerId === meId;
    const nameOf = (id: string, fallback: string): string =>
      displayName(fallback, room?.state.players.get(id)?.isBot ?? false);
    const killerName = nameOf(m.killerId, m.killerName);
    const badges = awardBadges(m);
    const assisted = (m.assistIds ?? []).includes(meId);
    hud.pushFeed(
      {
        ...m,
        killer: killerName,
        victim: nameOf(m.victimId, m.victimName),
        assists: (m.assistIds ?? []).map((id, i) => nameOf(id, m.assistNames?.[i] ?? '?')),
      },
      mine || assisted ? 'good' : m.victimId === meId ? 'bad' : 'neutral',
    );
    if (mine) hud.announce(badges);
    if (m.victimId === meId) {
      hud.showDeath(killerName, m.weapon, m.headshot, badges, m.melee ?? MELEE_SWORD, m.gun ?? GUN_NONE);
      hud.deathFlash();
    }
  };
  const onPong = (t: number): void => {
    rtt = performance.now() - t;
    hud.setPing(rtt);
  };
  const onLeaveRoom = (): void => {
    if (ended) return;
    ended = true;
    finish();
    opts.onLeft('Disconnected from the room');
  };

  let poseTimer = 0;
  let pingTimer = 0;
  if (room) {
    room.onMessage(MSG.shot, onShot);
    room.onMessage(MSG.swung, onSwung);
    room.onMessage(MSG.pickup, onPickup);
    room.onMessage(MSG.explode, onExplode);
    room.onMessage(MSG.hit, onHit);
    room.onMessage(MSG.kill, onKill);
    room.onMessage(MSG.flag, onFlag);
    room.onMessage(MSG.round, onRound);
    room.onMessage(MSG.pong, onPong);
    room.onStateChange(onPatch);
    room.onLeave(onLeaveRoom);
    poseTimer = window.setInterval(() => {
      if (!local.alive || ended) return;
      const m: PoseMsg = { ...currentPose(), weapon: weapons.current };
      room.send(MSG.pose, m);
    }, POSE_INTERVAL_MS);
    pingTimer = window.setInterval(() => room.send(MSG.ping, performance.now()), 2000);
    hud.setPing(null);
  }

  // --- frame loop ---
  let raf = 0;
  let last = performance.now();
  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // TD: frozen in place (look around only) while the 3-2-1 countdown runs; the banner counts it down.
    const frozen = td && local.alive && now < frozenUntil;
    if (td) {
      const count = frozen ? Math.ceil((frozenUntil - now) / 1000) : 0;
      if (count !== freezeCount) {
        if (count > 0) hud.roundBanner(String(count), 1200);
        else if (local.alive && frozenUntil > 0) hud.roundBanner('FIGHT!', 900);
        freezeCount = count;
      }
    }
    const inputEnabled = look.locked && !frozen;
    if (inputEnabled) {
      if (keys.wasPressed('Digit1')) weapons.select(WEAPON_PRIMARY);
      if (keys.wasPressed('Digit2')) weapons.select(WEAPON_PISTOL);
      if (keys.wasPressed('Digit3')) weapons.select(WEAPON_MELEE);
      if (keys.wasPressed('Digit4')) weapons.select(WEAPON_GRENADE);
      if (keys.wasPressed('Digit5')) weapons.select(WEAPON_TASER);
      if (canPickMelee) MELEE_PICK_KEYS.forEach((code, i) => keys.wasPressed(code) && pickMelee(MELEE_KINDS[i]));
      if (canPickPrimary) PRIMARY_PICK_KEYS.forEach((code, i) => keys.wasPressed(code) && pickPrimary(PRIMARY_KINDS[i]));
      if (canPickPrimary && keys.wasPressed('KeyB')) pickPrimary(GUN_TASER);
      if (keys.wasPressed('KeyR') && local.alive) weapons.reload(now);
      if (keys.wasPressed('KeyG') && local.alive) {
        // G: hand off the carried flag; otherwise throw the held weapon away (frees the slot so a ground weapon can be picked up).
        if (carrying !== null) room?.send(MSG.dropFlag, epoch);
        else if (weapons.current === WEAPON_PRIMARY || weapons.current === WEAPON_TASER || (weapons.current === WEAPON_MELEE && weapons.melee !== MELEE_SWORD)) {
          room?.send(MSG.dropWeapon, { epoch, slot: weapons.current });
        }
      }
    }
    // Shift as well as Ctrl: Ctrl+W closes the tab in Chrome (unpreventable), and C is
    // taken by the training range's gun picker (Z X C V N).
    crouching =
      inputEnabled && local.alive && !frozen && (keys.isDown('ShiftLeft') || keys.isDown('ShiftRight') || keys.isDown('ControlLeft') || keys.isDown('ControlRight'));
    const speedScale = Math.min(
      weapons.charging ? weapons.chargeSpeedScale : 1,
      carrying !== null ? FLAG_CARRY_SPEED_SCALE : 1,
      crouching ? CROUCH_SPEED_SCALE : 1,
    );
    const moving = local.update(dt, inputEnabled, speedScale, crouching);
    // Dead: after the death overlay has had its moment, sit in a team-mate's (or anyone's,
    // in a free-for-all) head. `local.update` just wrote the camera, so we simply overwrite it.
    if (!local.alive && epoch > 0) {
      const eligible = spectateEligible();
      if (spectateTarget !== null || spectateReady(diedAt, now)) setSpectateTarget(retainTarget(eligible, spectateTarget));
    }
    const specPose = spectateTarget !== null ? remotes.pose(spectateTarget, now) : null;
    if (specPose) {
      camera.position.set(specPose.x, specPose.y + EYE_HEIGHT, specPose.z);
      camera.rotation.set(specPose.pitch, specPose.yaw, 0, 'YXZ');
    }
    if (local.alive) weapons.update(now);
    recoil.update(dt, now);
    const charge = weapons.chargeFraction(now);
    viewModel.setCharge(charge);
    hud.setCharge(charge ?? weapons.throwChargeFraction(now));
    const reload = weapons.reloadFraction(now);
    viewModel.setReload(reload);
    // Watching a team-mate: the health, weapon, ammo and slot panels show theirs — our own corpse's are useless.
    const watched = spectateTarget !== null ? room?.state.players.get(spectateTarget) : undefined;
    if (watched) {
      const loadout = spectateLoadout(watched, allowed);
      hud.setWeapon(loadout.weapon, loadout.melee, loadout.gun);
      hud.setGrenades(loadout.grenades);
      hud.setHealth(loadout.hp);
      hud.setShield(loadout.shielded);
      hud.setAmmo(loadout.ammo, loadout.mag, loadout.reloading, loadout.perShell);
      hud.setSlots(loadout.usable, loadout.weapon);
    } else {
      hud.setAmmo(weapons.ammo, weapons.magOf(weapons.current), reload !== null, weapons.perShell);
      const usable: Record<number, boolean> = {};
      for (const w of WEAPONS) usable[w] = weapons.canUse(w);
      hud.setSlots(usable, weapons.current);
    }
    // Sniper zoom: narrow the FOV while RMB is held (dead, RMB is spectate-previous instead).
    const zoom = local.alive ? weapons.zoomFactor : 1;
    if (camera.fov !== baseFov / zoom) {
      camera.fov = baseFov / zoom;
      camera.updateProjectionMatrix();
    }
    look.sensitivityScale = 1 / zoom; // scoped aim slows in step with the narrowed FOV

    hud.setScope(weapons.zooming, weapons.zoomCapable);
    viewModel.update(dt, moving && local.state.onGround);
    remotes.update(now, {
      world,
      // Nametags are gated by what the rendered viewpoint sees — ours, or the spectated player's.
      eye: specPose
        ? { x: specPose.x, y: specPose.y + EYE_HEIGHT, z: specPose.z }
        : { x: local.state.x, y: local.state.y + EYE_HEIGHT, z: local.state.z },
      dir: specPose ? forwardVector(specPose.yaw, specPose.pitch) : forwardVector(look.yaw, look.pitch),
      team: meNet()?.team ?? TEAM_NONE,
    });
    drops.update(now);
    grenades.update(now);
    if (ctf && room) {
      // Flags: on their stand / on the ground where the state says; carried ones ride on the carrier's rendered body (never our own back).
      for (const team of [TEAM_RED, TEAM_BLUE] as const) {
        const f = flagOf(team);
        if (!f) continue;
        if (f.status === 'carried') {
          const at = f.carrierId === meId ? null : (remotes.position(f.carrierId) ?? { x: f.x, y: f.y, z: f.z });
          flags.set(team, at ? { status: 'carried', x: at.x, y: at.y, z: at.z } : null);
        } else {
          flags.set(team, { status: f.status, x: f.x, y: f.y, z: f.z });
        }
      }
      flags.update(now);
    }
    tracers.update(now);
    blood.update(now);
    bulletHoles.update(now);
    // Minimap: my team is always drawn, enemies only where somebody on my side
    // has line of sight, and the enemy flag leaves a last-seen pin behind.
    const myTeam = meNet()?.team ?? TEAM_NONE;
    const mates: MapDot[] = [];
    const foes: { id: string; pos: Vec3; team: number }[] = [];
    const observers: Vec3[] = [{ x: local.state.x, y: local.state.y, z: local.state.z }];
    room?.state.players.forEach((p, id) => {
      if (id === meId || !p.alive) return;
      const at = remotes.position(id) ?? { x: p.x, y: p.y, z: p.z };
      if (isTeam(myTeam) && p.team === myTeam) {
        mates.push({ id, x: at.x, z: at.z, team: p.team });
        observers.push({ x: at.x, y: at.y, z: at.z });
      } else {
        foes.push({ id, pos: { x: at.x, y: at.y, z: at.z }, team: p.team });
      }
    });
    const mine = ctf && isTeam(myTeam) ? flagOf(myTeam) : undefined;
    const theirs = ctf && isTeam(myTeam) ? flagOf(otherTeam(myTeam)) : undefined;
    minimap.update(now, {
      self: { x: local.state.x, y: local.state.y, z: local.state.z, yaw: look.yaw, alive: local.alive },
      myTeam,
      mates,
      enemies: foes,
      observers,
      ownFlag: mine ? { status: mine.status, x: mine.x, y: mine.y, z: mine.z } : null,
      enemyFlag: theirs ? { status: theirs.status, x: theirs.x, y: theirs.y, z: theirs.z } : null,
    });
    hud.update(now);
    if (room) {
      if (!td) hud.setTimer(Math.max(0, lastTimeLeft - (now - lastTimeLeftAt)));
      if (!local.alive && diedAt > 0) {
        // TD: the dead spectate until the next round (no respawn clock to count down).
        if (td) {
          const left = roundEndedAt > 0 ? TD_INTERMISSION_MS - (now - roundEndedAt) : null;
          hud.setDeathNote(left !== null && left > 0 ? `Next round in ${Math.ceil(left / 1000)}…` : 'Spectating — back next round');
        } else {
          hud.setRespawnCountdown(respawnMsFor(roomMode) - (now - diedAt));
        }
      }
      hud.setScoreboard(keys.isDown('Tab'), rankingRows(), meId, teamSummary());
    } else {
      hud.setTimer(0);
    }
    keys.endFrame();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    clearInterval(poseTimer);
    clearInterval(pingTimer);
    if (room) {
      room.onStateChange.remove(onPatch);
      room.onLeave.remove(onLeaveRoom);
    }
    recoil.dispose();
    look.dispose();
    keys.dispose();
    hud.dispose();
    minimap.dispose();
    viewModel.dispose();
    remotes.dispose();
    drops.dispose();
    grenades.dispose();
    flags.dispose();
    tracers.dispose();
    blood.dispose();
    bulletHoles.dispose();
    worldMesh.dispose();
    bundle.dispose();
  };

  // Apply the state we already have (players present before we joined, etc.).
  onPatch();

  if (import.meta.env.DEV) {
    // Dev-only hook for the headless smoke test (scripts/smoke.mjs); stripped from production builds.
    (window as unknown as { __mineshoot?: unknown }).__mineshoot = { room, local, look, weapons, hud, camera, ready: sendReady, pickMelee, pickPrimary };
  }

  return { dispose: finish };
}
