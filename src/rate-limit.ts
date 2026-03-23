/**
 * Application-level rate limiting for connection attempts and typing events.
 *
 * Connection attempts are tracked per IP + failure type with a sliding window
 * and ban period. Typing events are throttled per socket + ticket to prevent
 * indicator spam.
 *
 * @module rate-limit
 */

/** @internal */
interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

/** @internal */
interface TypingRecord {
  lastEmit: number;
  count: number;
}

/** Maximum failed connection attempts before ban. */
const MAX_CONNECTION_ATTEMPTS = 5;
/** Sliding window for counting attempts (1 min). */
const CONNECTION_ATTEMPT_WINDOW = 60_000;
/** Ban duration after exceeding max attempts (5 min). */
const CONNECTION_ATTEMPT_BAN_TIME = 300_000;

/** Minimum interval between typing events per socket+ticket (1 sec). */
const TYPING_RATE_LIMIT_MS = 1_000;
/** Maximum typing events per minute per socket+ticket. */
const TYPING_RATE_LIMIT_COUNT = 10;

const connectionAttempts = new Map<string, AttemptRecord>();
const typingRateLimits = new Map<string, TypingRecord>();

/**
 * Records a failed connection attempt and checks if the IP is banned.
 *
 * @param ip   - Client IP address
 * @param type - Failure reason (`"no-token"` or `"invalid-token"`)
 * @returns Error message if the IP is currently banned, `null` if allowed
 */
export function checkConnectionAttempt(
  ip: string,
  type: 'no-token' | 'invalid-token',
): string | null {
  const now = Date.now();
  const key = `${type}:${ip}`;
  const attempts = connectionAttempts.get(key);

  if (attempts) {
    if (
      now - attempts.firstAttempt < CONNECTION_ATTEMPT_BAN_TIME &&
      attempts.count >= MAX_CONNECTION_ATTEMPTS
    ) {
      return type === 'no-token'
        ? 'Too many connection attempts'
        : 'Too many invalid token attempts';
    }
    if (now - attempts.firstAttempt > CONNECTION_ATTEMPT_WINDOW) {
      connectionAttempts.delete(key);
    } else {
      attempts.count++;
      attempts.lastAttempt = now;
    }
  } else {
    connectionAttempts.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
  }

  if (connectionAttempts.size > 1000) {
    for (const [k, v] of connectionAttempts.entries()) {
      if (now - v.lastAttempt > CONNECTION_ATTEMPT_WINDOW * 2) {
        connectionAttempts.delete(k);
      }
    }
  }

  return null;
}

/**
 * Returns the current failed attempt count for an IP + failure type.
 * Useful for logging escalation thresholds.
 */
export function getAttemptCount(ip: string, type: 'no-token' | 'invalid-token'): number {
  return connectionAttempts.get(`${type}:${ip}`)?.count ?? 0;
}

/** Clears all connection attempt records for an IP after successful auth. */
export function clearConnectionAttempts(ip: string): void {
  connectionAttempts.delete(`no-token:${ip}`);
  connectionAttempts.delete(`invalid-token:${ip}`);
}

/**
 * Checks whether a typing event should be forwarded.
 *
 * Enforces a minimum interval ({@link TYPING_RATE_LIMIT_MS}) and a per-minute
 * cap ({@link TYPING_RATE_LIMIT_COUNT}) per socket + ticket combination.
 *
 * @returns `true` if the event is allowed, `false` if throttled
 */
export function checkTypingRateLimit(socketId: string, ticketId: string, userId: string): boolean {
  const key = `${socketId}:${ticketId}:${userId}`;
  const now = Date.now();
  const limit = typingRateLimits.get(key);

  if (limit) {
    const elapsed = now - limit.lastEmit;
    if (elapsed < TYPING_RATE_LIMIT_MS) return false;
    if (limit.count >= TYPING_RATE_LIMIT_COUNT && elapsed < 60_000) return false;
    limit.lastEmit = now;
    limit.count = elapsed < 60_000 ? limit.count + 1 : 1;
  } else {
    typingRateLimits.set(key, { lastEmit: now, count: 1 });
  }

  if (typingRateLimits.size > 500) {
    for (const [k, v] of typingRateLimits.entries()) {
      if (now - v.lastEmit > 120_000) typingRateLimits.delete(k);
    }
  }

  return true;
}

/** Removes all typing rate limit records for a disconnected socket. */
export function cleanupSocketRateLimits(socketId: string): void {
  for (const key of typingRateLimits.keys()) {
    if (key.startsWith(`${socketId}:`)) typingRateLimits.delete(key);
  }
}
