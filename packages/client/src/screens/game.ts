import * as THREE from 'three';
import {
  EYE_HEIGHT,
  FLAG_CARRY_SPEED_SCALE,
  GUN_MAG_SIZE,
  MSG,
  PLAYER_HEIGHT,
  POSE_INTERVAL_MS,
  MELEE_KINDS,
  MELEE_SWORD,
  TEAM_BLUE,
  TEAM_RED,
  WEAPON_GUN,
  WEAPON_SWORD,
  allowedWeapons,
  attackSpec,
  forwardVector,
  generateWorldFor,
  isCtf,
  isTeam,
  meleeSelectable,
  meleeStats,
  otherTeam,
  rankCtf,
  rankPlayers,
  respawnMsFor,
  teamName,
} from '@mineshoot/shared';
import type { AttackKind, FlagEventMsg, HitMsg, KillMsg, MeleeKind, PickupMsg, PoseMsg, RankRow, RoomMode, SelectMeleeMsg, ShootMsg, ShotMsg, SwingMsg, SwungMsg, Team, Weapon } from '@mineshoot/shared';
import { displayName } from '../net';
import type { GameRoom, NetFlag, NetPlayer } from '../net';
import { FlagsView } from '../render/flagsView';
import { createScene } from '../render/scene';
import { buildWorldMeshes } from '../render/worldMesh';
import { Tracers } from '../render/tracers';
import { BloodFx } from '../render/bloodFx';
import { DropsView } from '../render/dropsView';
import { ViewModel } from '../render/viewmodel';
import { Keyboard } from '../input/keyboard';
import { PointerLook } from '../input/pointerLock';
import { LocalPlayer } from '../game/localPlayer';
import { RemotePlayers } from '../game/remotePlayers';
import { Weapons } from '../game/weapons';
import { Hud } from '../hud/hud';
import { awardBadges } from '../hud/icons';

/** Keys 3–7 pick a melee weapon directly where the room allows it (training range, offline sandbox). */
const MELEE_PICK_KEYS: readonly string[] = ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];

/** CTF outcome handed to the results screen. */
export interface CtfSummary {
  redScore: number;
  blueScore: number;
  captureLimit: number;
}

export interface GameScreenOptions {
  container: HTMLElement;
  /** null = offline sandbox (no networking). */
  room: GameRoom | null;
  seed: number;
  onEnded(ranking: RankRow[], meId: string, roomName: string, ctf?: CtfSummary): void;
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
  const { world, spawnPoints } = generateWorldFor(roomMode, opts.seed);

  const bundle = createScene(container);
  const { scene, camera, renderer } = bundle;
  const worldMesh = buildWorldMeshes(world);
  scene.add(worldMesh.group);
  const tracers = new Tracers();
  scene.add(tracers.group);
  const blood = new BloodFx();
  scene.add(blood.mesh);
  const remotes = new RemotePlayers();
  scene.add(remotes.group);
  const drops = new DropsView();
  scene.add(drops.group);
  const flags = new FlagsView();
  scene.add(flags.group);
  scene.add(camera); // so the view model (child of camera) renders
  const viewModel = new ViewModel(camera);

  const keys = new Keyboard();
  const look = new PointerLook(renderer.domElement);
  const hud = new Hud(container);

  const meNet = (): NetPlayer | undefined => room?.state.players.get(meId);
  const initial = meNet();
  const spawn = initial ?? { x: spawnPoints[0].x, y: spawnPoints[0].y, z: spawnPoints[0].z, yaw: 0 };
  const local = new LocalPlayer(world, camera, keys, look, spawn.x, spawn.y, spawn.z, spawn.yaw);
  let epoch = initial?.spawnEpoch ?? 1;
  let diedAt = 0;
  let ended = false;
  /** CTF: the flag we carry (its owning team), or null. */
  let carrying: Team | null = null;
  const canPickMelee = meleeSelectable(roomMode, weaponMode);
  hud.setRoomName(room ? (roomMode === 'training' ? `\u{1F3AF} ${room.state.name}` : ctf ? `\u{1F6A9} ${room.state.name}` : room.state.name) : 'Offline sandbox');
  hud.setWeaponRules(weaponMode, roomMode);

  // --- weapons ---
  const currentPose = (): ShootMsg => ({
    x: local.state.x,
    y: local.state.y,
    z: local.state.z,
    yaw: look.yaw,
    pitch: look.pitch,
    epoch,
  });
  const muzzle = (): THREE.Vector3 => {
    const f = forwardVector(look.yaw, look.pitch);
    const right = new THREE.Vector3(Math.cos(look.yaw), 0, -Math.sin(look.yaw));
    return new THREE.Vector3(local.state.x, local.state.y + EYE_HEIGHT, local.state.z)
      .addScaledVector(right, 0.25)
      .add(new THREE.Vector3(0, -0.18, 0))
      .addScaledVector(new THREE.Vector3(f.x, f.y, f.z), 0.5);
  };
  const weapons = new Weapons({
    onFire() {
      viewModel.fire();
      if (room) room.send(MSG.shoot, currentPose());
      else {
        const f = forwardVector(look.yaw, look.pitch);
        const m = muzzle();
        tracers.spawn(m, { x: m.x + f.x * 40, y: m.y + f.y * 40, z: m.z + f.z * 40 });
      }
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
      hud.setWeapon(w, weapons.melee);
    },
    onReload() {
      room?.send(MSG.reload, epoch);
    },
    onMeleeChange(kind: MeleeKind) {
      viewModel.setMelee(kind);
      hud.setWeapon(weapons.current, kind);
    },
  }, allowedWeapons(weaponMode));
  viewModel.setWeapon(weapons.current);
  hud.setWeapon(weapons.current, weapons.melee);
  /** Training range / sandbox: arm `kind` in the melee slot and bring it out (the server confirms via the state patch). */
  const pickMelee = (kind: MeleeKind): void => {
    if (!canPickMelee || !local.alive) return;
    if (room) {
      const m: SelectMeleeMsg = { epoch, melee: kind };
      room.send(MSG.selectMelee, m);
    } else {
      weapons.setMelee(kind);
    }
    weapons.select(WEAPON_SWORD);
    hud.toast(meleeStats(kind).name);
  };

  // --- input wiring ---
  look.onMouseDown = (b) => {
    if (!local.alive) return;
    if (b === 0) weapons.mouseDown(performance.now());
    else if (b === 2) weapons.altDown(performance.now());
  };
  look.onMouseUp = (b) => {
    if (b === 0) weapons.mouseUp(performance.now());
    else if (b === 2) weapons.altUp(performance.now());
  };
  look.onWheel = () => weapons.toggle();
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
    room?.state.players.forEach((p, id) => rows.push({ id, name: p.name, kills: p.kills, deaths: p.deaths, isBot: p.isBot, team: p.team, captures: p.captures, alive: p.alive }));
    return ctf ? rankCtf(rows) : rankPlayers(rows);
  };
  const ctfSummary = (): CtfSummary | undefined =>
    room && ctf ? { redScore: room.state.redScore, blueScore: room.state.blueScore, captureLimit: room.state.captureLimit } : undefined;
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
        weapons.resetAmmo();
        hud.hideDeath();
        renderer.domElement.classList.remove('dead');
      } else if (!me.alive && local.alive) {
        // Either killed, or (epoch 0) not yet spawned because we haven't clicked to play.
        local.alive = false;
        diedAt = epoch > 0 ? now : 0;
        weapons.cancel();
        // Grey out the world while dead (not on the initial click-to-play overlay).
        renderer.domElement.classList.toggle('dead', epoch > 0);
      }
      // Melee slot follows the server (drop pickups arm it, death resets it to the sword).
      weapons.setMelee(me.melee as MeleeKind);
      hud.setStats(me.kills, me.deaths);
      hud.setHealth(me.hp);
      hud.setShield(me.alive && me.shielded);
      if (ctf) {
        // Team buttons on the overlay (also lets an unspawned player pick a side; the camera follows the new side).
        const counts: Record<Team, number> = { [TEAM_RED]: 0, [TEAM_BLUE]: 0 };
        state.players.forEach((p) => {
          if (isTeam(p.team)) counts[p.team]++;
        });
        hud.setTeams(isTeam(me.team) ? me.team : 0, counts);
        if (me.spawnEpoch === 0 && !local.alive) local.teleport(me.x, me.y, me.z, me.yaw);
      }
    }
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
    // Weapon drops on the ground.
    const dropIds = new Set<string>();
    state.drops?.forEach((d, id) => {
      dropIds.add(id);
      if (!drops.has(id)) drops.add(id, d.kind as MeleeKind, d.x, d.y, d.z);
    });
    drops.retain(dropIds);
    if (state.timeLeftMs !== lastTimeLeft) {
      lastTimeLeft = state.timeLeftMs;
      lastTimeLeftAt = now;
    }
    if (state.phase === 'ended') {
      ended = true;
      finish();
      opts.onEnded(rankingRows(), meId, state.name, ctfSummary());
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
    const from = m.shooterId === meId ? muzzle() : m.from;
    tracers.spawn(from, m.to, m.shooterId === meId ? 0xfff2a8 : 0xffb46b);
    if (m.shooterId === meId && m.hitPlayerId) hud.hitmark(m.part === 'head');
    if (m.hitPlayerId === meId) hud.damageFlash(m.damage);
    if (m.hitPlayerId && m.hitPlayerId !== meId) {
      blood.burst(m.to, m.damage, { x: m.to.x - from.x, y: m.to.y - from.y, z: m.to.z - from.z });
    }
    if (m.shooterId !== meId) remotes.shot(m.shooterId, performance.now());
  };
  const onSwung = (m: SwungMsg): void => {
    if (m.attackerId !== meId) remotes.swing(m.attackerId, m.attack, m.melee, performance.now());
  };
  const onPickup = (m: PickupMsg): void => {
    if (m.playerId !== meId) return;
    // Arm it right away (the state patch will confirm) and bring it out if the room allows.
    weapons.setMelee(m.melee);
    weapons.select(WEAPON_SWORD);
    hud.toast(`Picked up ${meleeStats(m.melee).name}`);
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
    hud.pushFeed(
      { ...m, killer: killerName, victim: nameOf(m.victimId, m.victimName) },
      mine ? 'good' : m.victimId === meId ? 'bad' : 'neutral',
    );
    if (mine) hud.announce(badges);
    if (m.victimId === meId) {
      hud.showDeath(killerName, m.weapon, m.headshot, badges, m.melee ?? MELEE_SWORD);
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
    room.onMessage(MSG.hit, onHit);
    room.onMessage(MSG.kill, onKill);
    room.onMessage(MSG.flag, onFlag);
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

    const inputEnabled = look.locked;
    if (inputEnabled) {
      if (keys.wasPressed('Digit1')) weapons.select(WEAPON_GUN);
      if (keys.wasPressed('Digit2')) weapons.select(WEAPON_SWORD);
      if (canPickMelee) MELEE_PICK_KEYS.forEach((code, i) => keys.wasPressed(code) && pickMelee(MELEE_KINDS[i]));
      if (keys.wasPressed('KeyR') && local.alive) weapons.reload(now);
      if (keys.wasPressed('KeyG') && local.alive && carrying !== null) room?.send(MSG.dropFlag, epoch);
    }
    const speedScale = Math.min(weapons.charging ? weapons.chargeSpeedScale : 1, carrying !== null ? FLAG_CARRY_SPEED_SCALE : 1);
    const moving = local.update(dt, inputEnabled, speedScale);
    if (local.alive) weapons.update(now);
    const charge = weapons.chargeFraction(now);
    viewModel.setCharge(charge);
    hud.setCharge(charge);
    const reload = weapons.reloadFraction(now);
    viewModel.setReload(reload);
    hud.setAmmo(weapons.ammo, GUN_MAG_SIZE, reload !== null);
    viewModel.update(dt, moving && local.state.onGround);
    remotes.update(now);
    drops.update(now);
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
    hud.update(now);
    if (room) {
      hud.setTimer(Math.max(0, lastTimeLeft - (now - lastTimeLeftAt)));
      if (!local.alive && diedAt > 0) hud.setRespawnCountdown(respawnMsFor(roomMode) - (now - diedAt));
      hud.setScoreboard(keys.isDown('Tab'), rankingRows(), meId, ctfSummary());
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
    look.dispose();
    keys.dispose();
    hud.dispose();
    viewModel.dispose();
    remotes.dispose();
    drops.dispose();
    flags.dispose();
    tracers.dispose();
    blood.dispose();
    worldMesh.dispose();
    bundle.dispose();
  };

  // Apply the state we already have (players present before we joined, etc.).
  onPatch();

  if (import.meta.env.DEV) {
    // Dev-only hook for the headless smoke test (scripts/smoke.mjs); stripped from production builds.
    (window as unknown as { __mineshoot?: unknown }).__mineshoot = { room, local, look, weapons, hud, ready: sendReady, pickMelee };
  }

  return { dispose: finish };
}
