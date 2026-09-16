// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FRAME_TICKET_TTL_MS, mintFrameTicket, readFrameTicket } from "./pageFrameTicket";

const DOC = "tdoc_0f8fad5b-d9cb-469f-a165-70867728950e";
const FILE = "tdf_7c9e6679-7425-40de-944b-e07fc1f90ae7";
const saved = { enc: process.env.TOKEN_ENC_KEY, role: process.env.SUPABASE_SERVICE_ROLE_KEY };

describe("page frame tickets", () => {
  beforeEach(() => { process.env.TOKEN_ENC_KEY = "test-secret"; });
  afterEach(() => { process.env.TOKEN_ENC_KEY = saved.enc; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.role; });

  it("opens the one file it was made for", () => {
    const ticket = mintFrameTicket(DOC, FILE)!;
    expect(ticket).toMatch(/^pf_/);
    expect(readFrameTicket(ticket)).toEqual({ documentId: DOC, fileId: FILE });
  });

  it("stops opening after 30 minutes", () => {
    const now = Date.now();
    const ticket = mintFrameTicket(DOC, FILE, now)!;
    expect(readFrameTicket(ticket, now + FRAME_TICKET_TTL_MS - 1)).not.toBeNull();
    expect(readFrameTicket(ticket, now + FRAME_TICKET_TTL_MS)).toBeNull();
  });

  it("refuses a ticket whose contents were changed", () => {
    const ticket = mintFrameTicket(DOC, FILE)!;
    const [payload, mac] = ticket.slice(3).split(".");
    const forged = Buffer.from(JSON.stringify({ d: DOC, f: "tdf_00000000-0000-0000-0000-000000000000", e: Date.now() + 60_000 })).toString("base64url");
    expect(readFrameTicket(`pf_${forged}.${mac}`)).toBeNull();
    // A character that is definitely NOT the one already there: the signature
    // covers a timestamp, so about one run in sixty four minted a MAC ending in
    // "A", where swapping in an "A" changed nothing and the ticket verified.
    const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    expect(readFrameTicket(`pf_${payload}.${flipped}`)).toBeNull();
  });

  it("refuses a ticket made with another secret", () => {
    const ticket = mintFrameTicket(DOC, FILE)!;
    process.env.TOKEN_ENC_KEY = "another-secret";
    expect(readFrameTicket(ticket)).toBeNull();
  });

  it("falls back to the service role key when TOKEN_ENC_KEY is not set", () => {
    delete process.env.TOKEN_ENC_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "role-secret";
    expect(readFrameTicket(mintFrameTicket(DOC, FILE)!)).toEqual({ documentId: DOC, fileId: FILE });
  });

  it("makes nothing without any secret", () => {
    delete process.env.TOKEN_ENC_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(mintFrameTicket(DOC, FILE)).toBeNull();
  });

  it.each(["", "pf_", "doc_abc", "pf_abc.def", "pf_" + "a".repeat(20) + "." + "b".repeat(42)])("refuses the malformed ticket %j", (bad) => {
    expect(readFrameTicket(bad)).toBeNull();
  });
});
