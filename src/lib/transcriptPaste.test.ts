import { describe, it, expect } from "vitest";
import { checkTranscriptSave, recordingUrl, storageSafeName, transcriptBoxReason, transcriptFileName, transcriptNameFor, transcriptSavePayload, TRANSCRIPT_MAX_BYTES, isTranscriptFile } from "./transcriptPaste";
import { undoAction } from "./undoAction";
import { withMeetingSteps, type Subtask } from "./data";

describe("transcriptFileName", () => {
  it("names it like a meeting's transcript: Transcript · name · date", () => {
    expect(transcriptFileName("Meet with Pam", "2026-10-15")).toBe("Transcript · Meet with Pam · 2026-10-15.txt");
  });
  it("keeps the name to one plain line", () => {
    expect(transcriptFileName("  Kickoff / plan:\nPam  ", "2026-10-15")).toBe("Transcript · Kickoff plan Pam · 2026-10-15.txt");
    expect(transcriptFileName("", "2026-10-15")).toBe("Transcript · Meeting · 2026-10-15.txt");
    expect(transcriptFileName("x".repeat(200), "2026-10-15")).toBe(`Transcript · ${"x".repeat(80)} · 2026-10-15.txt`);
  });
  it("stores under a plain key", () => {
    expect(storageSafeName("Transcript · Meet with Pam · 2026-10-15.txt")).toBe("Transcript-Meet-with-Pam-2026-10-15.txt");
    expect(storageSafeName("Meeting transcript 2026-10-15.txt")).toBe("Meeting-transcript-2026-10-15.txt");
  });
});

describe("transcriptNameFor", () => {
  const steps: Subtask[] = [
    { id: "s1", title: "Send the agenda", done: true },
    { id: "s2", title: "Meet with Pam", done: false, addedFor: "meeting" },
    { id: "s3", title: "Add the meeting transcript", done: false, addedFor: "transcript", finishWhen: "transcript" },
  ];
  it("uses the meeting step for the stock transcript step", () => {
    expect(transcriptNameFor(steps[2], steps, "Website kickoff")).toBe("Meet with Pam");
  });
  it("uses a step's own name otherwise", () => {
    expect(transcriptNameFor(steps[0], steps, "Website kickoff")).toBe("Send the agenda");
  });
  it("falls back to the task's name", () => {
    const lone: Subtask = { id: "s9", title: "Add the meeting transcript", done: false };
    expect(transcriptNameFor(lone, [lone], "Website kickoff")).toBe("Website kickoff");
  });
});

describe("transcriptSavePayload", () => {
  it("is nothing when nothing was entered", () => {
    expect(transcriptSavePayload({ stepId: "s3", name: "Meet with Pam", text: "   \n ", link: "zoom.us/rec/1" })).toBeNull();
  });
  it("keeps pasted text exactly as pasted, with the recording link", () => {
    const text = "  Derek: Hi\n\nPam: Hello  ";
    expect(transcriptSavePayload({ stepId: "s3", name: "Meet with Pam", text, link: " fathom.video/share/abc " }))
      .toEqual({ stepId: "s3", name: "Meet with Pam", text, link: "https://fathom.video/share/abc" });
  });
  it("sends a dropped file's attachment when nothing is pasted, and drops a link that isn't one", () => {
    expect(transcriptSavePayload({ stepId: "s3", name: "M", text: "", attachmentId: "a_1", link: "not a link" }))
      .toEqual({ stepId: "s3", name: "M", attachmentId: "a_1" });
  });
});

describe("checkTranscriptSave", () => {
  it("takes text, a link and the step", () => {
    const r = checkTranscriptSave({ stepId: "s3", name: "Meet with Pam", text: "Hi", link: "https://zoom.us/rec/1" });
    expect(r).toEqual({ ok: true, value: { stepId: "s3", name: "Meet with Pam", text: "Hi", link: "https://zoom.us/rec/1" } });
  });
  it("refuses nothing, no step, a bad link and over 2 MB", () => {
    expect(checkTranscriptSave({ stepId: "s3", text: "  " }).ok).toBe(false);
    expect(checkTranscriptSave({ text: "Hi" }).ok).toBe(false);
    expect(checkTranscriptSave({ stepId: "s3", text: "Hi", link: "javascript:alert(1)" }).ok).toBe(false);
    expect(checkTranscriptSave({ stepId: "s3", text: "x".repeat(TRANSCRIPT_MAX_BYTES + 1) }).ok).toBe(false);
    expect(checkTranscriptSave({ stepId: "s3", attachmentId: "../../etc" }).ok).toBe(false);
  });
});

describe("the rest", () => {
  it("knows a transcript file", () => {
    expect(["a.txt", "b.VTT", "c.srt", "d.docx", "e.pdf", "f.md"].every(isTranscriptFile)).toBe(true);
    expect(isTranscriptFile("g.mp4")).toBe(false);
  });
  it("only takes web links", () => {
    expect(recordingUrl("youtu.be/x")).toBe("https://youtu.be/x");
    expect(recordingUrl("ftp://x.com")).toBeNull();
    expect(recordingUrl("")).toBeNull();
  });
  it("says why the box opened", () => {
    expect(transcriptBoxReason({})).toBe("Granola didn't find this meeting. Paste it or drop the file.");
    expect(transcriptBoxReason({ connect: true })).toBe("Granola isn't connected. Paste it or drop the file.");
    expect(transcriptBoxReason({ error: "Granola didn't answer." })).toBe("Granola didn't answer. Paste it or drop the file.");
  });
  it("closing the box empty takes the Granola try's steps back off (undoAction)", () => {
    const before: Subtask[] = [{ id: "s1", title: "Plan the site", done: false, startedAt: "2026-10-15T10:00:00Z" }];
    let n = 0;
    const after = withMeetingSteps(before, "Pam", "2026-10-15", () => `m${++n}`)!;
    const back = undoAction({ before: { subtasks: before }, after: { subtasks: after } }, { subtasks: after });
    expect(back?.subtasks).toEqual(before);
    expect(back?.removed).toEqual(["m1", "m2"]);
  });
});
