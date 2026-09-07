import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// Reversible storage for personal API tokens, so an existing one can be copied
// again rather than only rotated (Derek, 2026-09-06: "make it so we can copy
// the already generated code").
//
// A token you can read back is, by construction, weaker than a hash you
// cannot. The job of this module is to keep "the database leaked" and "the
// tokens leaked" as two separate events instead of one:
//
//   token_hash  sha256. Still the ONLY thing authentication compares against.
//   token_enc   AES-256-GCM ciphertext, read only when someone clicks Copy.
//
// The key lives in TOKEN_ENC_KEY, an environment variable, and never in the
// database. A table dump, a leaked backup, or read access through the
// service-role key yields ciphertext and nothing else; you would need the
// running app's environment as well. That is the entire security argument, so
// do not put the key anywhere Postgres can reach.
//
// GCM rather than CBC because it authenticates as well as encrypts: a tampered
// row fails to decrypt instead of returning plausible garbage that then gets
// handed to somebody as their token.

const ALGO = "aes-256-gcm";

/** The 32 byte key, or null when the variable is missing or malformed.
 *
 *  Null is a supported state, not a failure. Without a key the app behaves
 *  exactly as it did before this feature: tokens are hashed, Rotate works,
 *  and only the ability to copy an existing one is absent. */
function key(): Buffer | null {
  // Trimmed before anything looks at it. A trailing newline is the normal
  // result of piping a generated key into a form or a CLI, and without this
  // the value fails every check below and the app reports itself as having no
  // key at all — which looks exactly like the variable never being set, and
  // cost an afternoon of hunting the wrong thing.
  const raw = process.env.TOKEN_ENC_KEY?.trim();
  if (!raw) return null;
  // Either 64 hex characters or a base64 32 byte value, since which one you
  // have depends on how the key was generated.
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export const tokenCryptoReady = () => key() !== null;

/** iv.tag.ciphertext, each base64url, dot separated. Null when no key is
 *  configured, in which case the token is stored hashed only and simply is
 *  not copyable. */
export function encryptToken(plain: string): string | null {
  const k = key();
  if (!k) return null;
  // 12 bytes is the standard GCM nonce length, and it is fresh per token:
  // reusing a nonce under one key is the single mistake that breaks GCM.
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

/** The token back, or null for anything that does not decrypt cleanly: no key,
 *  a malformed value, a row written under a different key, or one that has
 *  been tampered with. Every one of those means "you cannot copy this", never
 *  a guess at what the token might have been. */
export function decryptToken(stored: string | null | undefined): string | null {
  const k = key();
  if (!k || !stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv(ALGO, k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** What authentication compares against. Unchanged by any of the above, and
 *  deliberately still the only column requireApiToken reads. */
export const hashToken = (plain: string) => createHash("sha256").update(plain).digest("hex");
