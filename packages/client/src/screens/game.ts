import * as THREE from 'three';
import {
  EYE_HEIGHT,
  GUN_MAG_SIZE,
  MSG,
  POSE_INTERVAL_MS,
  RESPAWN_MS,
  SWORD_CHARGE_SPEED_SCALE,
  WEAPON_GUN,
  WEAPON_SWORD,
  allowedWeapons,
  forwardVector,
  generateWorld,
  rankPlayers,
} from '@mineshoot/shared';
import type { HitMsg, KillMsg, PoseMsg, RankRow, ShootMsg, ShotMsg, SwingMsg, Weapon } from '@mineshoot/shared';
import { displayName } from '../net';
import type { GameRoom, NetPlayer } from '../net';
import { createScene } from '../render/scene';
import { buildWorldMeshes } from '../render/worldMesh';
import { Tracers } from '../render/tracers';
import { ViewModel } from '../render/viewmodel';
import { Keyboard } from '../input/keyboard';
import { PointerLook } from '../input/pointerLock';
import { LocalPlayer } from '../game/localPlayer';
import { RemotePlayers } from '../game/remotePlayers';
import { Weapons } from '../game/weapons';
import { Hud } from '../hud/hud';

export interface GameScreenOptions {
  container: HTMLElement;
  /** null = offline sandbox (no networking). */
  room: GameRoom | null;
  seed: number;
  onEnded(ranking: RankRow[], meId: string, roomName: string): void;
  onLeft(message: string): void;
}

/** Composes world, local/remote players, weapons, HUD and the network loop. */
export function startGame(opts: GameScreenOptions): { dispose(): void } {
  const { container, room } = opts;
  const meId = room?.sessionId ?? 'me';
  const { world, spawnPoints } = generateWorld(opts.seed);

  const bundle = createScene(container);
  const { scene, camera, renderer } = bundle;
  const worldMesh = buildWorldMeshes(world);
  scene.add(worldMesh.group);
  const tracers = new Tracers();
  scene.add(tracers.group);
  const remotes = new RemotePlayers();
  scene.add(remotes.group);
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
  const weaponMode = room?.state.weapons ?? 'all';
  hud.setRoomName(room ? room.state.name : 'Offline sandbox');
  hud.setWeaponRules(weaponMode);

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
    onSwing(charged: boolean) {
      viewModel.swing();
      const m: SwingMsg = { ...currentPose(), charged };
      room?.send(MSG.swing, m);
    },
    onSwitch(w: Weapon) {
      viewModel.setWeapon(w);
      hud.setWeapon(w);
    },
    onReload() {
      room?.send(MSG.reload, epoch);
    },
  }, allowedWeapons(weaponMode));
  viewModel.setWeapon(weapons.current);
  hud.setWeapon(weapons.current);

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
    room?.state.players.forEach((p, id) => rows.push({ id, name: p.name, kills: p.kills, deaths: p.deaths, isBot: p.isBot }));
    return rankPlayers(rows);
  };

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
      } else if (!me.alive && local.alive) {
        // Either killed, or (epoch 0) not yet spawned because we haven't clicked to play.
        local.alive = false;
        diedAt = epoch > 0 ? now : 0;
        weapons.cancel();
      }
      hud.setStats(me.kills, me.deaths);
      hud.setHealth(me.hp);
      hud.setShield(me.alive && me.shielded);
    }
    if (state.timeLeftMs !== lastTimeLeft) {
      lastTimeLeft = state.timeLeftMs;
      lastTimeLeftAt = now;
    }
    if (state.phase === 'ended') {
      ended = true;
      finish();
      opts.onEnded(rankingRows(), meId, state.name);
    }
  };

  const onShot = (m: ShotMsg): void => {
    const from = m.shooterId === meId ? muzzle() : m.from;
    tracers.spawn(from, m.to, m.shooterId === meId ? 0xfff2a8 : 0xffb46b);
    if (m.shooterId === meId && m.hitPlayerId) hud.hitmark(m.part === 'head');
    if (m.hitPlayerId === meId) hud.damageFlash();
  };
  const onHit = (m: HitMsg): void => {
    if (m.attackerId === meId) hud.hitmark(m.part === 'head');
    else remotes.swing(m.attackerId);
    if (m.victimId === meId) hud.damageFlash();
  };
  const onKill = (m: KillMsg): void => {
    const verb = m.weapon === WEAPON_GUN ? '🔫' : '🗡️';
    const mine = m.killerId === meId;
    const nameOf = (id: string, fallback: string): string =>
      displayName(fallback, room?.state.players.get(id)?.isBot ?? false);
    const killerName = nameOf(m.killerId, m.killerName);
    hud.pushFeed(`${killerName} ${verb} ${nameOf(m.victimId, m.victimName)}`, mine || m.victimId === meId);
    if (m.victimId === meId) {
      hud.showDeath(killerName, m.weapon);
      hud.damageFlash();
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
    room.onMessage(MSG.hit, onHit);
    room.onMessage(MSG.kill, onKill);
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
      if (keys.wasPressed('KeyR') && local.alive) weapons.reload(now);
    }
    const moving = local.update(dt, inputEnabled, weapons.charging ? SWORD_CHARGE_SPEED_SCALE : 1);
    if (local.alive) weapons.update(now);
    const charge = weapons.chargeFraction(now);
    viewModel.setCharge(charge);
    hud.setCharge(charge);
    const reload = weapons.reloadFraction(now);
    viewModel.setReload(reload);
    hud.setAmmo(weapons.ammo, GUN_MAG_SIZE, reload !== null);
    viewModel.update(dt, moving && local.state.onGround);
    remotes.update(now);
    tracers.update(now);
    hud.update(now);
    if (room) {
      hud.setTimer(Math.max(0, lastTimeLeft - (now - lastTimeLeftAt)));
      if (!local.alive && diedAt > 0) hud.setRespawnCountdown(RESPAWN_MS - (now - diedAt));
      hud.setScoreboard(keys.isDown('Tab'), rankingRows(), meId);
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
    tracers.dispose();
    worldMesh.dispose();
    bundle.dispose();
  };

  // Apply the state we already have (players present before we joined, etc.).
  onPatch();

  if (import.meta.env.DEV) {
    // Dev-only hook for the headless smoke test (scripts/smoke.mjs); stripped from production builds.
    (window as unknown as { __mineshoot?: unknown }).__mineshoot = { room, local, look, weapons, ready: sendReady };
  }

  return { dispose: finish };
}
