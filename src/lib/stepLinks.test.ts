import { describe, expect, it } from "vitest";
import { addTargetStep, chatLinkName, linkDisplayName, looksLikeIdName, prettyLinkName, taskDatesForStepDue } from "./data";

const steps = [
  { id: "s1", done: true },
  { id: "s2", done: false },
  { id: "s3", done: false },
  { id: "c1", done: false, fromClient: true },
];

describe("where a link or file added now goes", () => {
  it("goes on the step whose page is open", () => {
    expect(addTargetStep(steps, null, "s3")).toBe("s3");
  });
  it("goes on the current step from the task page by default", () => {
    expect(addTargetStep(steps, undefined)).toBe("s2");
  });
  it("goes on the step picked beside Link and Attach", () => {
    expect(addTargetStep(steps, "s3")).toBe("s3");
  });
  it("stays off the steps when Not on a step is picked", () => {
    expect(addTargetStep(steps, null)).toBeNull();
  });
  it("falls back to the current step when the picked one is done or gone", () => {
    expect(addTargetStep(steps, "s1")).toBe("s2");
    expect(addTargetStep(steps, "gone")).toBe("s2");
  });
  it("is nowhere when every step is done", () => {
    expect(addTargetStep([{ id: "s1", done: true }], undefined)).toBeNull();
  });
});

describe("a link's name", () => {
  it("names an AI chat by where it lives", () => {
    expect(prettyLinkName("https://chatgpt.com/c/6acfa6f6-ceb4-83e8-b663-27b6fbf564d9")).toBe("ChatGPT chat");
    expect(prettyLinkName("https://claude.ai/chat/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab")).toBe("Claude chat");
    expect(chatLinkName("https://chatgpt.com/")).toBeNull();
  });
  it("never reads a uuid as a name", () => {
    expect(prettyLinkName("https://example.com/files/6acfa6f6-ceb4-83e8-b663-27b6fbf564d9")).toBe("Files");
    expect(prettyLinkName("https://example.com/6acfa6f6-ceb4-83e8-b663-27b6fbf564d9")).toBe("example.com");
  });
  it("tells an id from a name", () => {
    expect(looksLikeIdName("6acfa6f6 ceb4 83e8 b663 27b6fbf564d9")).toBe(true);
    expect(looksLikeIdName("6acfa6f6-ceb4-83e8-b663-27b6fbf564d9")).toBe(true);
    expect(looksLikeIdName("a1b2c3d4e5f6a7b8c9")).toBe(true);
    expect(looksLikeIdName("m and m art")).toBe(false);
    expect(looksLikeIdName("Face cafe 2026")).toBe(false);
    expect(looksLikeIdName("Google Doc")).toBe(false);
  });
  it("shows a saved id name as the readable one", () => {
    expect(linkDisplayName({ name: "6acfa6f6 ceb4 83e8 b663 27b6fbf564d9", url: "https://chatgpt.com/c/6acfa6f6-ceb4-83e8-b663-27b6fbf564d9" })).toBe("ChatGPT chat");
    expect(linkDisplayName({ name: "Brief", url: "https://chatgpt.com/c/x1" })).toBe("Brief");
    expect(linkDisplayName({ name: "a1b2c3d4e5f6a7b8c9" })).toBe("a1b2c3d4e5f6a7b8c9");
  });
});

describe("a step's new due date and its task", () => {
  const base = { isCurrent: true, taskOwner: "u_derek" };
  it("the owner's current step moves the task's due, earlier or later", () => {
    expect(taskDatesForStepDue({ ...base, due: "2026-10-20", stepAssignee: "u_derek" })).toEqual({ due: "2026-10-20" });
    expect(taskDatesForStepDue({ ...base, due: "2026-10-01", stepAssignee: null })).toEqual({ due: "2026-10-01" });
  });
  it("a teammate's or Claude's current step keeps the handoff dates", () => {
    expect(taskDatesForStepDue({ ...base, due: "2026-10-16", stepAssignee: "u_justin" })).toEqual({ due: "2026-10-16", followUpAt: "2026-10-19" });
  });
  it("leaves the task alone otherwise", () => {
    expect(taskDatesForStepDue({ ...base, due: "2026-10-20", stepAssignee: "u_derek", upNext: true })).toBeNull();
    expect(taskDatesForStepDue({ ...base, due: "2026-10-20", onClient: true })).toBeNull();
    expect(taskDatesForStepDue({ ...base, due: "2026-10-20", isCurrent: false })).toBeNull();
    expect(taskDatesForStepDue({ ...base, due: null })).toBeNull();
  });
});
