/**
 * REST API handler for internal broadcast requests from rvn-web.
 *
 * Each route emits a Socket.IO event to a specific room or uses
 * the engine's zero-copy {@link Engine.broadcast} for system-wide notifications.
 *
 * @module broadcast
 */

import type { Server } from 'socket.io';
import type { Server as Engine } from '@rvncom/socket-bun-engine';
import type {
  WebSocketEvents,
  SocketData,
  BroadcastMessagePayload,
  BroadcastTicketUpdatePayload,
  BroadcastTicketAssignedPayload,
  BroadcastMessageReadPayload,
  BroadcastCommentPayload,
  BroadcastSystemPayload,
} from './types';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/** Maximum request body size in bytes. */
const MAX_BODY_SIZE = 1_048_576; // 1 MB

/** Returns a 401 Unauthorized response. */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Returns a 200 OK response with `{ ok: true }`. */
function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Returns a 400 Bad Request response with the given error message. */
function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Routes an internal broadcast request to the appropriate Socket.IO room.
 *
 * Validates the `x-internal-api-key` header and Content-Length before
 * parsing the JSON body. Supported routes:
 *
 * - `POST /broadcast/support/message` — new support message
 * - `POST /broadcast/support/ticket-update` — ticket status change
 * - `POST /broadcast/support/ticket-assigned` — ticket assignment change
 * - `POST /broadcast/support/message-read` — message read receipts
 * - `POST /broadcast/profile/comment` — new profile comment
 * - `POST /broadcast/system` — system-wide notification (zero-copy broadcast)
 *
 * @param req      - Incoming HTTP request
 * @param pathname - Pre-parsed URL pathname
 * @param io       - Socket.IO server instance
 * @param engine   - Engine.IO server instance (used for system broadcast)
 * @returns HTTP response
 */
export async function handleBroadcastRequest(
  req: Request,
  pathname: string,
  io: Server<WebSocketEvents, WebSocketEvents, Record<string, never>, SocketData>,
  engine: Engine,
): Promise<Response> {
  if (!INTERNAL_API_KEY || req.headers.get('x-internal-api-key') !== INTERNAL_API_KEY) {
    return unauthorized();
  }

  // Body size limit — uses !(<=) to reject NaN from malformed headers
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!(length <= MAX_BODY_SIZE)) {
      return badRequest('Payload too large');
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON');
  }

  switch (pathname) {
    case '/broadcast/support/message': {
      const data = body as BroadcastMessagePayload;
      if (!data.ticketId || !data.message) return badRequest('Missing ticketId or message');
      io.to(`ticket:${data.ticketId}`).emit('support:message:new', data);
      return ok();
    }

    case '/broadcast/support/ticket-update': {
      const data = body as BroadcastTicketUpdatePayload;
      if (!data.ticketId || !data.ticket) return badRequest('Missing ticketId or ticket');
      io.to(`ticket:${data.ticketId}`).emit('support:ticket:updated', data);
      return ok();
    }

    case '/broadcast/support/ticket-assigned': {
      const data = body as BroadcastTicketAssignedPayload;
      if (!data.ticketId) return badRequest('Missing ticketId');
      io.to(`ticket:${data.ticketId}`).emit('support:ticket:assigned', data);
      return ok();
    }

    case '/broadcast/support/message-read': {
      const data = body as BroadcastMessageReadPayload;
      if (!data.ticketId || !data.messageIds) return badRequest('Missing ticketId or messageIds');
      io.to(`ticket:${data.ticketId}`).emit('support:message:read', data);
      return ok();
    }

    case '/broadcast/profile/comment': {
      const data = body as BroadcastCommentPayload;
      if (!data.profileId || !data.comment) return badRequest('Missing profileId or comment');
      io.to(`profile:${data.profileId}`).emit('profile:comment:new', data);
      return ok();
    }

    case '/broadcast/system': {
      const data = body as BroadcastSystemPayload;
      if (!data.message) return badRequest('Missing message');
      // Zero-copy broadcast via Engine.IO:
      // "2" is the Socket.IO EVENT packet type, engine prepends "4" (message).
      // Final wire frame: '42["system:notification",{...}]'
      const packet = '2' + JSON.stringify(['system:notification', data]);
      engine.broadcast(packet);
      return ok();
    }

    default:
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
  }
}
