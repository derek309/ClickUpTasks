import { describe, it, expect } from "vitest";
import { dedupName, dedupPhone, sameContact, clientContactIds, findDuplicateTrackedClient } from "./clientDedup";
import type { Client, Contact } from "./data";

const ct = (o: Partial<Contact>): Contact => ({ id: "c", name: "", ...o } as Contact);
const cl = (o: Partial<Client>): Client => ({ id: "cl_x", name: "X", ...o } as unknown as Client);

// A wrong merge folds two businesses into one record and splits neither back
// out again. A missed merge leaves a duplicate somebody notices. The rule is
// tuned for that asymmetry, and these tests pin it.
describe("deciding whether two contacts are the same business", () => {
  it("folds phone formatting away", () => {
    expect(dedupPhone("+1 (555) 123-4567")).toBe(dedupPhone("5551234567"));
  });
  it("does not pad a short number into a match", () => {
    expect(dedupPhone("1234")).toBe("1234");
    expect(sameContact(ct({ phone: "1234" }), ct({ phone: "9991234" }))).toBe(false);
  });
  it("folds case and spacing in names", () => {
    expect(dedupName("  Acme   Plumbing ")).toBe("acme plumbing");
  });

  it("matches on email regardless of case or padding", () => {
    expect(sameContact(ct({ email: "A@B.test " }), ct({ email: "a@b.test" }))).toBe(true);
  });
  it("matches on phone across formats", () => {
    expect(sameContact(ct({ phone: "(555) 123 4567" }), ct({ phone: "+15551234567" }))).toBe(true);
  });
  it("matches a long name", () => {
    expect(sameContact(ct({ name: "Acme Plumbing" }), ct({ name: "acme  plumbing" }))).toBe(true);
  });

  // The important negative: a short name must not collapse two businesses.
  it("refuses to match on a short name", () => {
    expect(sameContact(ct({ name: "ABC" }), ct({ name: "abc" }))).toBe(false);
    expect(sameContact(ct({ name: "Jo" }), ct({ name: "jo" }))).toBe(false);
  });
  it("treats missing fields as no evidence, not as a match", () => {
    expect(sameContact(ct({}), ct({}))).toBe(false);
    expect(sameContact(ct({ name: "" }), ct({ name: "" }))).toBe(false);
  });
});

describe("finding the client that already represents a contact", () => {
  const contacts: Record<string, Contact> = {
    c1: ct({ id: "c1", name: "Acme Plumbing", email: "hi@acme.test" }),
    c2: ct({ id: "c2", name: "Other Co", email: "other@x.test" }),
  };
  const byId = (id: string) => contacts[id] ?? null;

  it("finds a client through its own contact id", () => {
    const found = findDuplicateTrackedClient(ct({ id: "new", email: "hi@acme.test" }), [cl({ id: "cl_c1" })], byId);
    expect(found).toBe("cl_c1");
  });
  it("finds a client through a contact it absorbed in an earlier merge", () => {
    const found = findDuplicateTrackedClient(
      ct({ id: "new", email: "hi@acme.test" }),
      [cl({ id: "cl_zz", linkedContactIds: ["c1"] })], byId,
    );
    expect(found).toBe("cl_zz");
  });
  it("never matches a contact against its own client", () => {
    expect(findDuplicateTrackedClient(contacts.c1, [cl({ id: "cl_c1" })], byId)).toBeNull();
  });
  it("ignores clients that are not tracked contacts at all", () => {
    expect(findDuplicateTrackedClient(ct({ id: "new", email: "hi@acme.test" }), [cl({ id: "c_agency" })], byId)).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(findDuplicateTrackedClient(ct({ id: "new", email: "nobody@x.test" }), [cl({ id: "cl_c1" })], byId)).toBeNull();
  });
  it("counts every id a client is known by", () => {
    expect(clientContactIds(cl({ id: "cl_a", linkedContactId: "b", linkedContactIds: ["c"] }))).toEqual(["a", "b", "c"]);
  });
});
