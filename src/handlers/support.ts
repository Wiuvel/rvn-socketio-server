/**
 * Support ticket WebSocket handlers.
 *
 * Handles room join/leave with ticket access verification,
 * typing indicator broadcasts with rate limiting, and
 * per-socket cleanup on disconnect.
 *
 * @module handlers/support
 */

import type { Socket } from 'socket.io';
import type { WebSocketEvents, SocketData, AckResponse } from '../types';
import { verifyTicketAccess } from '../auth';
import { checkTypingRateLimit, cleanupSocketRateLimits } from '../rate-limit';
import { isValidUUID } from '../utils';

/**
 * Registers support-related event handlers on a connected socket.
 *
 * @param socket - Authenticated Socket.IO socket with {@link SocketData}
 */
export function registerSupportHandlers(
  socket: Socket<WebSocketEvents, WebSocketEvents, Record<string, never>, SocketData>,
): void {
  const { userId, isSupport, user } = socket.data;

  socket.on(
    'support:join',
    async (data: { ticketId: string }, ack: (response: AckResponse) => void) => {
      const { ticketId } = data;
      if (!ticketId || !isValidUUID(ticketId)) {
        socket.emit('support:error', { message: 'Invalid ticket ID', code: 'INVALID_TICKET_ID' });
        if (typeof ack === 'function') ack({ ok: false, error: 'INVALID_TICKET_ID' });
        return;
      }

      try {
        const allowed = await verifyTicketAccess(ticketId, userId, isSupport);
        if (!allowed) {
          socket.emit('support:error', { message: 'Access denied', code: 'ACCESS_DENIED' });
          if (typeof ack === 'function') ack({ ok: false, error: 'ACCESS_DENIED' });
          return;
        }

        socket.join(`ticket:${ticketId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        console.error(`[ws] Failed to verify ticket access for ${ticketId}`);
        socket.emit('support:error', { message: 'Verification failed', code: 'VERIFY_FAILED' });
        if (typeof ack === 'function') ack({ ok: false, error: 'VERIFY_FAILED' });
      }
    },
  );

  socket.on('support:leave', (data) => {
    const { ticketId } = data;
    if (!ticketId || !isValidUUID(ticketId)) return;
    socket.leave(`ticket:${ticketId}`);
  });

  socket.on('support:typing', (data) => {
    const { ticketId, isTyping } = data;
    if (!ticketId || typeof isTyping !== 'boolean' || !userId) return;
    if (!isValidUUID(ticketId)) return;

    const room = `ticket:${ticketId}`;
    if (!socket.rooms.has(room)) return;
    if (!checkTypingRateLimit(socket.id, ticketId, userId)) return;

    socket.to(room).emit('support:typing:status', {
      ticketId,
      userId,
      username: user?.username || '',
      isTyping,
    });
  });

  socket.on('disconnect', () => {
    cleanupSocketRateLimits(socket.id);
  });
}
