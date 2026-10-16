import { describe, it, expect } from "vitest";
import { readableName, replyAllCc, replyBelongs, replyPeer } from "./replyRecipients";

// Chelsea Proctor's email on Brian Goodell's task (2026-10-16): she is not a
// contact, so the row has no client, only the task. Reply goes to her, with
// the others who were on it in Cc and our own addresses left off.
const chelsea = {
  channel: "email", clientId: "", taskId: "t_brian",
  peerAddress: "CProctor@usatventures.com", peerName: "Proctor, Chelsea",
  cc: ["brian@bibboards.com", "jtranquill@usatventures.com", "derek@clickuplocal.com", "cproctor@usatventures.com", "Brian@BibBoards.com"],
};

describe("replying to an email", () => {
  it("goes to the person who wrote it, by name", () => {
    expect(replyPeer(chelsea)).toEqual({ email: "cproctor@usatventures.com", name: "Chelsea Proctor" });
  });

  it("copies everyone else on it, less our addresses and the person it goes to", () => {
    expect(replyAllCc(chelsea, "cproctor@usatventures.com")).toEqual(["brian@bibboards.com", "jtranquill@usatventures.com"]);
    expect(replyAllCc(chelsea, "cproctor@usatventures.com", ["jtranquill@usatventures.com"])).toEqual(["brian@bibboards.com"]);
  });

  it("is from this task even with no client, but not another client's email", () => {
    expect(replyBelongs(chelsea, { clientId: "cl_brian", taskId: "t_brian" })).toBe(true);
    expect(replyBelongs(chelsea, { clientId: "cl_brian", taskId: "t_other" })).toBe(false);
    expect(replyBelongs(chelsea, { clientId: "cl_brian", taskId: "t_other", onStep: true })).toBe(true);
    expect(replyBelongs({ ...chelsea, clientId: "cl_other", taskId: null }, { clientId: "cl_brian", taskId: "t_brian" })).toBe(false);
    expect(replyBelongs({ ...chelsea, taskId: "t_x" }, { clientId: "cl_brian", taskClientId: "cl_brian" })).toBe(true);
    expect(replyBelongs({ ...chelsea, taskId: "t_x" }, { clientId: "cl_brian", taskClientId: "cl_other" })).toBe(false);
  });

  it("never goes to one of our own addresses", () => {
    expect(replyPeer({ ...chelsea, peerAddress: "derek@clickuplocal.com" })).toBeNull();
    expect(replyPeer({ ...chelsea, channel: "sms" })).toBeNull();
  });

  it("reads a Last, First name the way people say it", () => {
    expect(readableName("Proctor, Chelsea")).toBe("Chelsea Proctor");
    expect(readableName("Russell Lathrop")).toBe("Russell Lathrop");
    expect(readableName("")).toBeNull();
  });
});
