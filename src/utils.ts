/**
 * Shared utility functions.
 *
 * @module utils
 */

/** RFC 4122 UUID v4 pattern (case-insensitive). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns `true` if the string is a valid UUID v4. */
export function isValidUUID(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Parses a `Cookie` header string into a key-value record.
 *
 * Values are URI-decoded; if decoding fails, the raw value is used.
 * Returns an empty object when the header is `undefined`.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  }
  return result;
}
