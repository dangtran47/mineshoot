import http from 'node:http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@mineshoot/shared';
import type { RoomMetadata } from '@mineshoot/shared';
import { ArenaRoom } from './rooms/ArenaRoom';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' } as const;

/** Public lobby entry, as served by GET /rooms. */
export interface RoomListEntry {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  metadata: RoomMetadata;
}

export async function listRooms(): Promise<RoomListEntry[]> {
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  return rooms
    .filter((r) => !r.locked)
    .map((r) => ({
      roomId: r.roomId,
      clients: r.clients,
      maxClients: r.maxClients,
      locked: r.locked,
      metadata: r.metadata ?? { name: '', durationMin: 0, endsAt: 0, bots: 0, weapons: 'all' },
    }))
    .sort((a, b) => b.metadata.endsAt - a.metadata.endsAt);
}

/** Plain-http routes: health check for deploys + public room list for the
 * lobby (colyseus.js 0.16 has no client-side room listing). Colyseus handles
 * /matchmake itself. */
export function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'GET' && req.url === '/rooms') {
    void listRooms().then(
      (rooms) => {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rooms));
      },
      () => {
        res.writeHead(500, CORS_HEADERS);
        res.end();
      },
    );
    return;
  }
  res.writeHead(404, CORS_HEADERS);
  res.end();
}

export interface AppOptions {
  /** Disable process signal hooks (for tests). */
  gracefullyShutdown?: boolean;
}

export function createApp(options: AppOptions = {}): { gameServer: Server; httpServer: http.Server } {
  const httpServer = http.createServer(handleHttpRequest);
  // Disable Nagle on every socket: small 20Hz packets must not wait for ACKs.
  httpServer.on('connection', (socket) => socket.setNoDelay(true));
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    gracefullyShutdown: options.gracefullyShutdown ?? true,
    greet: false,
  });
  gameServer.define(ROOM_NAME, ArenaRoom);
  return { gameServer, httpServer };
}
