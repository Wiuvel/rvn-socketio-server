/**
 * Profile comments WebSocket handlers.
 *
 * Manages room join/leave for real-time comment updates on user profiles.
 *
 * @module handlers/profile
 */

import type { Socket } from 'socket.io';
import type { WebSocketEvents, SocketData } from '../types';
import { isValidUUID } from '../utils';

/**
 * Registers profile-related event handlers on a connected socket.
 *
 * @param socket - Authenticated Socket.IO socket with {@link SocketData}
 */
export function registerProfileHandlers(
  socket: Socket<WebSocketEvents, WebSocketEvents, Record<string, never>, SocketData>,
): void {
  socket.on('profile:join', (data) => {
    const { profileId } = data;
    if (!profileId || !isValidUUID(profileId)) return;
    socket.join(`profile:${profileId}`);
  });

  socket.on('profile:leave', (data) => {
    const { profileId } = data;
    if (!profileId || !isValidUUID(profileId)) return;
    socket.leave(`profile:${profileId}`);
  });
}
