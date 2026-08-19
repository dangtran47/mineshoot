import './hud/style.css';
import type { RankRow } from '@mineshoot/shared';
import type { GameRoom } from './net';
import { showLobby } from './screens/lobby';
import { startGame } from './screens/game';
import type { CtfSummary } from './screens/game';
import { showResults } from './screens/results';

const app = document.getElementById('app')!;
let current: { dispose(): void } | null = null;

function swap(next: { dispose(): void }): void {
  current?.dispose();
  current = next;
}

function lobby(message?: string): void {
  swap(
    showLobby({
      container: app,
      message,
      onJoined: (room) => game(room),
      onOffline: () => sandbox(),
    }),
  );
}

function game(room: GameRoom): void {
  swap(
    startGame({
      container: app,
      room,
      seed: room.state.seed,
      onEnded: (ranking, meId, roomName, ctf) => results(room, ranking, meId, roomName, ctf),
      onLeft: (message) => lobby(message),
    }),
  );
}

function results(room: GameRoom, ranking: RankRow[], meId: string, roomName: string, ctf?: CtfSummary): void {
  swap(
    showResults(
      app,
      ranking,
      meId,
      roomName,
      () => {
        void room.leave();
        lobby();
      },
      ctf,
    ),
  );
}

function sandbox(): void {
  const seed = Number(new URLSearchParams(location.search).get('seed') ?? 1234) || 1234;
  swap(startGame({ container: app, room: null, seed, onEnded: () => lobby(), onLeft: (m) => lobby(m) }));
}

if (new URLSearchParams(location.search).has('offline')) sandbox();
else lobby();
