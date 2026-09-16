// SERVER-ONLY: compare a secret a caller sent with the one we expect, in
// constant time, so the comparison itself can't be used to guess it a
// character at a time. Used by every shared-secret door into this app
// (cronAuth.ts, the MCP handler).
import { timingSafeEqual } from "node:crypto";

export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}
