/**
 * Authentication via HTTP callback to rvn-web.
 *
 * Token verification and ticket access checks are cached in-memory
 * with TTL-based expiration and bounded map sizes.
 *
 * @module auth
 */

import type { AuthUser, VerifyTokenResponse, VerifyTicketAccessResponse } from './types';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/** Token verification cache: SHA-256 hash -> { user, expiry }. */
const tokenCache = new Map<string, { user: AuthUser; expires: number }>();
/** @internal */ const TOKEN_CACHE_TTL = 60_000;
/** @internal */ const MAX_TOKEN_CACHE_SIZE = 10_000;

/** Ticket access cache: "ticketId:userId" -> { allowed, expiry }. */
const ticketAccessCache = new Map<string, { allowed: boolean; expires: number }>();
/** @internal */ const TICKET_ACCESS_CACHE_TTL = 30_000;
/** @internal */ const MAX_TICKET_CACHE_SIZE = 10_000;

/** Periodic cache eviction (every 5 minutes). */
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of tokenCache.entries()) {
    if (now > val.expires) tokenCache.delete(key);
  }
  for (const [key, val] of ticketAccessCache.entries()) {
    if (now > val.expires) ticketAccessCache.delete(key);
  }
}, 5 * 60_000);

/**
 * Computes a SHA-256 hex digest of the given token.
 * Used as cache key to avoid storing raw tokens in memory.
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parameters for the token verification callback. */
export interface VerifyTokenParams {
  token: string;
  sessionId: string;
  tokenFromCookie: string;
  ip: string;
  userAgent: string;
}

/**
 * Verifies a user token by calling the rvn-web internal API.
 *
 * Successful results are cached by token hash for {@link TOKEN_CACHE_TTL}.
 * Cache is bounded to {@link MAX_TOKEN_CACHE_SIZE} entries (FIFO eviction).
 *
 * @param params - Token and session context
 * @returns Authenticated user or `null` on failure
 */
export async function verifyToken(params: VerifyTokenParams): Promise<AuthUser | null> {
  const tokenHash = await hashToken(params.token);

  const cached = tokenCache.get(tokenHash);
  if (cached && Date.now() < cached.expires) {
    return cached.user;
  }

  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/internal/verify-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as VerifyTokenResponse;
    if (!data.valid || !data.user) return null;

    if (tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
      const firstKey = tokenCache.keys().next().value;
      if (firstKey) tokenCache.delete(firstKey);
    }
    tokenCache.set(tokenHash, { user: data.user, expires: Date.now() + TOKEN_CACHE_TTL });
    return data.user;
  } catch {
    console.error('[auth] Failed to verify token via callback');
    return null;
  }
}

/**
 * Verifies whether a user has access to a specific support ticket.
 *
 * Support users bypass the check entirely. Results are cached for
 * {@link TICKET_ACCESS_CACHE_TTL}.
 *
 * @param ticketId  - Ticket to check access for
 * @param userId    - User requesting access
 * @param isSupport - Whether the user has the support role
 * @returns `true` if access is allowed
 */
export async function verifyTicketAccess(
  ticketId: string,
  userId: string,
  isSupport: boolean,
): Promise<boolean> {
  if (isSupport) return true;

  const cacheKey = `${ticketId}:${userId}`;
  const cached = ticketAccessCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.allowed;
  }

  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/internal/verify-ticket-access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ ticketId, userId, isSupport }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return false;

    const data = (await res.json()) as VerifyTicketAccessResponse;
    if (ticketAccessCache.size >= MAX_TICKET_CACHE_SIZE) {
      const firstKey = ticketAccessCache.keys().next().value;
      if (firstKey) ticketAccessCache.delete(firstKey);
    }
    ticketAccessCache.set(cacheKey, {
      allowed: data.allowed,
      expires: Date.now() + TICKET_ACCESS_CACHE_TTL,
    });
    return data.allowed;
  } catch {
    console.error('[auth] Failed to verify ticket access via callback');
    return false;
  }
}

/**
 * Removes all cached token entries for the given user.
 * Call on disconnect to prevent stale sessions from being served from cache.
 */
export function invalidateUserCache(userId: string): void {
  for (const [key, val] of tokenCache.entries()) {
    if (val.user.id === userId) tokenCache.delete(key);
  }
}
