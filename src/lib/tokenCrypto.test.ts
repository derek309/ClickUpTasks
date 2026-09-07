import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken, hashToken, tokenCryptoReady } from "./tokenCrypto";

// A round trip is the easy half. The half worth testing is everything that
// must NOT come back: a wrong key, a tampered row, a missing key.
const KEY_A = "a".repeat(64);                    // 32 bytes, hex
const KEY_B = "b".repeat(64);                    // a different 32 bytes
const TOKEN = "cut_bLkEkt3c7rMYC10aImKEx5P-qTk";

const withKey = (k: string | undefined) => { if (k === undefined) delete process.env.TOKEN_ENC_KEY; else process.env.TOKEN_ENC_KEY = k; };
let saved: string | undefined;
beforeEach(() => { saved = process.env.TOKEN_ENC_KEY; });
afterEach(() => { withKey(saved); });

describe("round trip", () => {
  it("gives the token back", () => {
    withKey(KEY_A);
    expect(decryptToken(encryptToken(TOKEN))).toBe(TOKEN);
  });
  it("accepts a base64 key as well as hex", () => {
    withKey(Buffer.alloc(32, 7).toString("base64"));
    expect(decryptToken(encryptToken(TOKEN))).toBe(TOKEN);
  });
  // Same key, same input, different output: a fresh nonce every time. Equal
  // ciphertexts would leak which tokens are identical.
  it("never produces the same ciphertext twice", () => {
    withKey(KEY_A);
    expect(encryptToken(TOKEN)).not.toBe(encryptToken(TOKEN));
  });
  it("does not contain the token in plain sight", () => {
    withKey(KEY_A);
    expect(encryptToken(TOKEN)).not.toContain("cut_");
  });
});

describe("what must not come back", () => {
  it("refuses a different key", () => {
    withKey(KEY_A);
    const enc = encryptToken(TOKEN)!;
    withKey(KEY_B);
    expect(decryptToken(enc)).toBeNull();
  });
  // GCM authenticates, so a flipped byte fails outright rather than returning
  // plausible garbage that then gets handed to somebody as their token.
  it("refuses a tampered value", () => {
    withKey(KEY_A);
    const [iv, tag, body] = encryptToken(TOKEN)!.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 0xff;
    expect(decryptToken([iv, tag, flipped.toString("base64url")].join("."))).toBeNull();
    expect(decryptToken([iv, "AAAAAAAAAAAAAAAAAAAAAA", body].join("."))).toBeNull();
  });
  it("refuses anything malformed", () => {
    withKey(KEY_A);
    for (const bad of ["", "nope", "a.b", "a.b.c.d", "!!!.???.***"]) expect(decryptToken(bad)).toBeNull();
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
  });
});

describe("without a key configured", () => {
  it("reports itself as not ready", () => {
    withKey(undefined);
    expect(tokenCryptoReady()).toBe(false);
  });
  // The degraded path: no key means tokens are stored hashed only, exactly as
  // before this feature. Nothing throws, nothing is copyable.
  it("stores nothing and reveals nothing", () => {
    withKey(undefined);
    expect(encryptToken(TOKEN)).toBeNull();
    expect(decryptToken("anything")).toBeNull();
  });
  it("treats a wrong-length key as no key at all", () => {
    withKey("tooshort");
    expect(tokenCryptoReady()).toBe(false);
    expect(encryptToken(TOKEN)).toBeNull();
  });
});

describe("hashToken", () => {
  // Unchanged by any of this: it is still the only thing auth compares.
  it("is a stable sha256", () => {
    expect(hashToken("cut_abc")).toBe(hashToken("cut_abc"));
    expect(hashToken("cut_abc")).toHaveLength(64);
    expect(hashToken("cut_abc")).not.toBe(hashToken("cut_abd"));
  });
  it("does not depend on the encryption key", () => {
    withKey(KEY_A);
    const a = hashToken(TOKEN);
    withKey(KEY_B);
    expect(hashToken(TOKEN)).toBe(a);
  });
});
