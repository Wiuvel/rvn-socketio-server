/**
 * Standalone Socket.IO server entry point.
 *
 * Binds Socket.IO to {@link @rvncom/socket-bun-engine} for native Bun WebSocket support.
 * Exposes REST endpoints for health checks and internal broadcast API.
 *
 * @module index
 */

import { Server as Engine } from '@rvncom/socket-bun-engine';
import { Server as SocketIOServer } from 'socket.io';
import type { WebSocketEvents, SocketData } from './types';
import { verifyToken, type VerifyTokenParams } from './auth';
import { checkConnectionAttempt, getAttemptCount, clearConnectionAttempts } from './rate-limit';
import { registerSupportHandlers } from './handlers/support';
import { registerProfileHandlers } from './handlers/profile';
import { handleBroadcastRequest } from './broadcast';
import { parseCookies } from './utils';

const PORT = Number(process.env.PORT) || 3002;
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOrigin =
  CORS_ORIGINS && CORS_ORIGINS.length > 0
    ? CORS_ORIGINS
    : process.env.NODE_ENV === 'development'
      ? true
      : false;

const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 0;

/** Engine.IO server with native Bun WebSocket transport. */
const engine = new Engine({
  path: '/socket.io/',
  pingTimeout: 20000,
  pingInterval: 25000,
  maxClients: MAX_CLIENTS,
  rateLimit: {
    maxMessages: 100,
    windowMs: 1000,
  },
  degradationThreshold: MAX_CLIENTS > 0 ? 0.85 : 0,
  enableMetrics: true,
  perMessageDeflate: true,
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  },
});

engine.on('degradation', ({ active, clients }) => {
  console.warn(`[ws] Degradation ${active ? 'ON' : 'OFF'} at ${clients} clients`);
});

engine.on('connection', (socket) => {
  socket.on('rateLimited', () => {
    console.warn(`[ws] Engine socket ${socket.id} rate limited`);
  });
});

/** Socket.IO server bound to the native engine. */
const io = new SocketIOServer<
  WebSocketEvents,
  WebSocketEvents,
  Record<string, never>,
  SocketData
>();
io.bind(engine);

/**
 * Authentication middleware.
 *
 * Extracts client IP from proxy headers, validates the auth token via
 * {@link verifyToken}, and populates `socket.data` with the authenticated user.
 * Failed attempts are tracked by {@link checkConnectionAttempt} for rate limiting.
 */
io.use(async (socket, next) => {
  try {
    const clientIP =
      socket.handshake.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      socket.handshake.headers['x-real-ip']?.toString() ||
      socket.handshake.address ||
      'unknown';

    const token = socket.handshake.auth?.token;

    if (!token) {
      const blocked = checkConnectionAttempt(clientIP, 'no-token');
      if (blocked) return next(new Error(blocked));
      if (getAttemptCount(clientIP, 'no-token') >= 3) {
        console.warn(`[ws] Multiple no-token attempts from ${clientIP}`);
      }
      return next(new Error('Authentication required'));
    }

    const cookieHeader = socket.handshake.headers.cookie;
    const cookies = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : undefined);
    const sessionId = cookies['session_id'] || '';
    const tokenFromCookie = cookies['token'] || '';

    const params: VerifyTokenParams = {
      token,
      sessionId,
      tokenFromCookie,
      ip: clientIP,
      userAgent: socket.handshake.headers['user-agent'] || 'unknown',
    };

    const user = await verifyToken(params);

    if (!user) {
      const blocked = checkConnectionAttempt(clientIP, 'invalid-token');
      if (blocked) return next(new Error(blocked));
      if (getAttemptCount(clientIP, 'invalid-token') >= 3) {
        console.warn(`[ws] Multiple invalid-token attempts from ${clientIP}`);
      }
      return next(new Error('Invalid token'));
    }

    clearConnectionAttempts(clientIP);

    socket.data.user = user;
    socket.data.userId = user.id;
    socket.data.isSupport = user.isSupport;

    next();
  } catch (error) {
    console.error('[ws] Auth error:', error instanceof Error ? error.message : error);
    next(new Error('Authentication failed'));
  }
});

/** Registers per-socket event handlers on new connection. */
io.on('connection', (socket) => {
  console.log(`[ws] Connected: ${socket.id} (user: ${socket.data.userId})`);

  registerSupportHandlers(socket);
  registerProfileHandlers(socket);

  socket.on('disconnect', (reason) => {
    console.log(`[ws] Disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error) => {
    if (
      !error.message?.includes('transport close') &&
      !error.message?.includes('transport error')
    ) {
      console.error(`[ws] Socket error: ${error.message}`);
    }
  });
});

const engineHandler = engine.handler();

/**
 * Bun.serve export — routes requests to health check, broadcast REST API,
 * or the Engine.IO transport handler.
 */
export default {
  port: PORT,
  async fetch(req: Request, bunServer: unknown) {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          connections: engine.clientsCount,
          degraded: engine.degraded,
          metrics: engine.metrics,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (req.method === 'POST' && url.pathname.startsWith('/broadcast/')) {
      return handleBroadcastRequest(req, url.pathname, io, engine);
    }

    return engineHandler.fetch(req, bunServer as Parameters<typeof engineHandler.fetch>[1]);
  },
  websocket: engineHandler.websocket,
};

/** Gracefully shuts down the engine and exits the process. */
function shutdown() {
  console.log('[ws] Shutting down...');
  engine.shutdown().then(() => {
    console.log('[ws] Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[ws] Socket.IO server running on port ${PORT}`);
