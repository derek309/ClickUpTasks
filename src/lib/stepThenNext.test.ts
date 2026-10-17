import { describe, expect, it } from "vitest";
import { addLeadItems, latestStepLine, stepQuietLine, stepThread, turnSentence, descriptionLabel, doneLandsWith, doneLine, finishButton, giveLabel, giverOf, isDraft, lastTickFinishes, lineExtras, messageTo, pickOnStep, questionAfter, questionFor, remindWord, stepMessageNotices, turnOf, turnWord, whatsNextButton, whatsNextSays, workingSections } from "./stepThenNext";
import { CLAUDE_ID } from "./data";

const o = { meId: "u_derek", clientFirst: "Brian", nameOf: (id: string) => ({ u_justin: "Justin", u_mich: "Michaella" } as Record<string, string>)[id] ?? "Someone" };

describe("the working step card (Derek, 2026-10-17)", () => {
  it("shows the step, top to bottom: Description, Checklist, what it uses, + Add, Done", () => {
    expect(workingSections({ done: false, description: true, checklist: true, using: true, canAdd: true, canFinish: true }))
      .toEqual(["description", "checklist", "using", "add", "done"]);
  });
  it("shows nothing empty: no Description or Checklist without something in it", () => {
    expect(workingSections({ done: false, description: false, checklist: false, using: false, canAdd: true, canFinish: true })).toEqual(["add", "done"]);
  });
  it("a done step has no + Add and no Done", () => {
    expect(workingSections({ done: true, description: true, checklist: true, using: false, canAdd: true, canFinish: true })).toEqual(["description", "checklist"]);
  });
  it("+ Add offers Checklist and Description while the step has neither, the other once one exists", () => {
    expect(addLeadItems({ description: false, checklist: false })).toEqual(["checklist", "description"]);
    expect(addLeadItems({ description: true, checklist: false })).toEqual(["checklist"]);
    expect(addLeadItems({ description: false, checklist: true })).toEqual(["description"]);
    expect(addLeadItems({ description: true, checklist: true })).toEqual([]);
  });
});

describe("whose turn", () => {
  const who = { meId: "u_derek", ownerId: "u_derek" };
  it("reads the step", () => {
    expect(turnOf({ assigneeId: undefined }, who)).toBe("me");
    expect(turnOf({ assigneeId: "u_mich" }, who)).toBe("teammate");
    expect(turnOf({ assigneeId: CLAUDE_ID }, who)).toBe("claude");
    expect(turnOf({ onClient: true }, who)).toBe("client");
    expect(turnOf({ finishWhen: "reply" }, who)).toBe("client");
  });
  it("client and Claude steps lead with their words; others read Description", () => {
    expect(descriptionLabel("client", "Brian")).toEqual({ label: "What we need from Brian", tone: "client" });
    expect(descriptionLabel("claude", "Brian")).toEqual({ label: "What Claude should do", tone: "claude" });
    expect(descriptionLabel("me", "Brian")).toEqual({ label: "Description", tone: null });
    expect(descriptionLabel("teammate", "Brian").label).toBe("Description");
  });
  it("the turn word", () => {
    expect(turnWord(null, o)).toBe("Your turn");
    expect(turnWord("u_derek", o)).toBe("Your turn");
    expect(turnWord("u_mich", o)).toBe("Michaella's turn");
    expect(turnWord(CLAUDE_ID, o)).toBe("Claude's turn");
    expect(turnWord("client", o)).toBe("Brian's turn");
  });
  it("the … offers by turn: a teammate's dates, the client's reminders, nothing for Claude", () => {
    expect(lineExtras("teammate")).toEqual(["priority", "onList", "checkBack", "ifNeeded"]);
    // The client's reminders are a word in the sentence now: "…" is Priority only.
    expect(lineExtras("client")).toEqual(["priority"]);
    expect(lineExtras("me")).toEqual(["priority"]);
    expect(lineExtras("claude")).toEqual(["ifNeeded"]);
  });
});

describe("the last tick is Done", () => {
  const todos = [{ id: "a", done: true }, { id: "b", done: false }];
  it("ticking the last open to do finishes the step", () => {
    expect(lastTickFinishes(todos, "b")).toBe(true);
  });
  it("not while another is open, or the client's portal item is", () => {
    expect(lastTickFinishes([...todos, { id: "c", done: false }], "b")).toBe(false);
    expect(lastTickFinishes(todos, "b", [{ done: false }])).toBe(false);
    expect(lastTickFinishes(todos, "b", [{ done: true }])).toBe(true);
  });
  it("unticking never finishes, so it can't finish twice", () => {
    expect(lastTickFinishes([{ id: "a", done: true }], "a")).toBe(false);
    expect(lastTickFinishes(todos, "missing")).toBe(false);
  });
});

describe("What's next's button follows whose turn", () => {
  it("Save for you, Give to a teammate, Give to Claude, Write the client's email", () => {
    expect(whatsNextButton("u_derek", o)).toBe("Save");
    expect(whatsNextButton(null, o)).toBe("Save");
    expect(whatsNextButton("u_justin", o)).toBe("Give to Justin");
    expect(whatsNextButton(CLAUDE_ID, o)).toBe("Give to Claude");
    expect(whatsNextButton("client", o)).toBe("Write Brian's email");
  });
  it("says in one line what will happen", () => {
    expect(whatsNextSays("client", o)).toBe("We email Brian the ask and wait for the reply.");
    expect(whatsNextSays(CLAUDE_ID, o)).toBe("Claude starts on it today.");
  });
  it("the step folds to one line", () => {
    expect(doneLine("Hand off", "u_mich", o)).toBe("✓ Hand off · done by Michaella");
    expect(doneLine("Hand off", "u_derek", o)).toBe("✓ Hand off · done by you");
    expect(doneLine("Hand off", null, o)).toBe("✓ Hand off · done");
  });
});

describe("draft until given (Derek, 2026-10-17)", () => {
  it("a step with draftFor is a draft until done; steps without it are live", () => {
    expect(isDraft({ done: false, draftFor: "u_mich" })).toBe(true);
    expect(isDraft({ done: false })).toBe(false);
    expect(isDraft({ done: true, draftFor: "u_mich" })).toBe(false);
  });
  it("picking someone on your own step makes it a draft for them; a step already with someone changes hands at once", () => {
    expect(pickOnStep({ done: false }, "me", "u_mich", "u_derek")).toBe("u_mich");
    expect(pickOnStep({ done: false }, "me", CLAUDE_ID, "u_derek")).toBe(CLAUDE_ID);
    expect(pickOnStep({ done: false }, "me", "client", "u_derek")).toBe("client");
    expect(pickOnStep({ done: false, draftFor: "u_mich" }, "me", "u_justin", "u_derek")).toBe("u_justin");
    // Yourself: never a draft.
    expect(pickOnStep({ done: false, draftFor: "u_mich" }, "me", "u_derek", "u_derek")).toBe("");
    expect(pickOnStep({ done: false }, "teammate", "u_justin", "u_derek")).toBeNull();
    expect(pickOnStep({ done: false }, "claude", "u_mich", "u_derek")).toBeNull();
    // Her step, given to her, though she is the one looking: changes hands at once.
    expect(pickOnStep({ done: false, assigneeId: "u_mich" }, "me", "u_justin", "u_mich", "u_derek")).toBeNull();
    // Your own step on your own task, assigned to you by name: still a draft.
    expect(pickOnStep({ done: false, assigneeId: "u_derek" }, "me", "u_mich", "u_derek", "u_derek")).toBe("u_mich");
  });
  it("the button: Give to on a draft, Done on your turn, Brian answered on the client's, none on hers", () => {
    expect(finishButton({ done: false, draftFor: "u_mich" }, "me")).toBe("give");
    expect(finishButton({ done: false, draftFor: "u_mich" }, "teammate")).toBe("none");
    expect(finishButton({ done: false }, "me")).toBe("done");
    expect(finishButton({ done: false }, "teammate")).toBe("none");
    expect(finishButton({ done: false }, "claude")).toBe("none");
    expect(finishButton({ done: false }, "client")).toBe("answered");
    expect(finishButton({ done: true }, "me")).toBeNull();
  });
  it("Give to names whose turn it will be", () => {
    expect(giveLabel("u_mich", o)).toBe("Give to Michaella");
    expect(giveLabel(CLAUDE_ID, o)).toBe("Give to Claude");
    expect(giveLabel("client", o)).toBe("Write Brian's email");
  });
});

describe("Message the other person on a teammate's step", () => {
  const owner = "u_derek";
  it("she writes to whoever gave it, falling back to the owner", () => {
    expect(messageTo({ done: false, assigneeId: "u_mich", givenBy: "u_justin" }, "me", { meId: "u_mich", ownerId: owner })).toBe("u_justin");
    expect(messageTo({ done: false, assigneeId: "u_mich" }, "me", { meId: "u_mich", ownerId: owner })).toBe(owner);
    expect(giverOf({}, owner)).toBe(owner);
  });
  it("the giver writes to her", () => {
    expect(messageTo({ done: false, assigneeId: "u_mich" }, "teammate", { meId: owner, ownerId: owner })).toBe("u_mich");
  });
  it("no link on the client's or Claude's step, a draft, a done step, or your own step nobody gave you", () => {
    expect(messageTo({ done: false }, "client", { meId: owner, ownerId: owner })).toBeNull();
    expect(messageTo({ done: false, assigneeId: CLAUDE_ID }, "claude", { meId: owner, ownerId: owner })).toBeNull();
    expect(messageTo({ done: false, draftFor: "u_mich" }, "me", { meId: owner, ownerId: owner })).toBeNull();
    expect(messageTo({ done: true, assigneeId: "u_mich" }, "teammate", { meId: owner, ownerId: owner })).toBeNull();
    expect(messageTo({ done: false }, "me", { meId: owner, ownerId: owner })).toBeNull();
  });
  it("her message to the giver is a question for him until he replies; his message to her changes nothing", () => {
    const step = { assigneeId: "u_mich" };
    const q = questionAfter(step, { from: "u_mich", to: owner, text: "\nWhich list is stores opened?\nI see two.", at: "2026-10-17T10:00:00Z" }, owner);
    expect(q).toEqual({ question: { from: "u_mich", to: owner, text: "Which list is stores opened?", at: "2026-10-17T10:00:00Z" } });
    expect(questionFor({ done: false, question: q!.question }, owner)?.from).toBe("u_mich");
    expect(questionFor({ done: false, question: q!.question }, "u_mich")).toBeNull();
    expect(questionAfter({ ...step, question: q!.question }, { from: owner, to: "u_mich", text: "Use the 90 day one.", at: "2026-10-17T11:00:00Z" }, owner)).toEqual({ question: undefined });
    expect(questionAfter(step, { from: owner, to: "u_mich", text: "FYI", at: "x" }, owner)).toBeNull();
  });
  it("notices: once per person, never the sender, the client or Claude", () => {
    expect(stepMessageNotices({ from: "u_mich", to: owner, mentioned: [owner, "u_justin", "u_mich"] })).toEqual([owner, "u_justin"]);
    expect(stepMessageNotices({ from: "u_justin", to: null, mentioned: [], inThread: ["u_mich", owner, "u_justin", "client", CLAUDE_ID] })).toEqual(["u_mich", owner]);
    expect(stepMessageNotices({ from: owner, to: "u_mich", mentioned: ["u_mich"], inThread: ["u_mich"] })).toEqual(["u_mich"]);
  });
});

describe("where a Done lands", () => {
  const owner = "u_derek";
  it("a teammate's Done comes back to whoever gave it", () => {
    expect(doneLandsWith({ assigneeId: "u_mich" }, "u_mich", owner)).toEqual({ back: owner });
    expect(doneLandsWith({ assigneeId: "u_mich", givenBy: "u_justin" }, "u_mich", owner)).toEqual({ back: "u_justin" });
    expect(doneLandsWith({ assigneeId: CLAUDE_ID }, CLAUDE_ID, owner)).toEqual({ back: owner });
  });
  it("the owner's own Done, or the giver marking it done for her, opens What's next as now", () => {
    expect(doneLandsWith({}, owner, owner)).toBe("next");
    expect(doneLandsWith({ assigneeId: "u_mich" }, owner, owner)).toBe("next");
  });
});

describe("the client's reminders word", () => {
  it("reads in the sentence", () => {
    expect(remindWord(3)).toBe("reminded every 3 days");
    expect(remindWord(null)).toBe("no reminders");
  });
});

describe("a plain note on her step's thread", () => {
  it("is no question; the giver's note on the thread answers one", () => {
    expect(questionAfter({ assigneeId: "u_mich" }, { from: "u_mich", to: null, text: "Started", at: "x" }, "u_derek")).toBeNull();
    const question = { from: "u_mich", to: "u_derek", text: "Which?", at: "x" };
    expect(questionAfter({ assigneeId: "u_mich", question }, { from: "u_derek", to: null, text: "This one", at: "y" }, "u_derek")).toEqual({ question: undefined });
  });
});

describe("back with the giver after her Done", () => {
  const mk = () => "s_new";
  const done = { id: "a", title: "Hand off", done: true, assigneeId: "u_mich", doneBy: "u_mich" };
  it("adds a what's next for the giver when nothing, or someone else's step, comes next", async () => {
    const { backToGiver } = await import("./stepThenNext");
    const one = backToGiver([done], "a", "u_derek", "u_derek", mk, "now")!;
    expect(one.map((x) => x.title)).toEqual(["Hand off", "Hand off: what's next?"]);
    expect(one[1]).toMatchObject({ addedFor: "next:a", done: false });
    expect(one[1].assigneeId).toBeUndefined();
    const toClient = backToGiver([done, { id: "b", title: "Brian approves", done: false, finishWhen: "reply" }], "a", "u_derek", "u_derek", mk, "now")!;
    expect(toClient.map((x) => x.id)).toEqual(["a", "s_new", "b"]);
    // A giver who is not the owner gets it on them.
    expect(backToGiver([done], "a", "u_justin", "u_derek", mk, "now")![1].assigneeId).toBe("u_justin");
  });
  it("adds nothing when the giver's own step comes next, or it was asked already", async () => {
    const { backToGiver } = await import("./stepThenNext");
    expect(backToGiver([done, { id: "b", title: "Check the send", done: false }], "a", "u_derek", "u_derek", mk, "now")).toBeNull();
    expect(backToGiver([done, { id: "q", title: "Hand off: what's next?", done: false, addedFor: "next:a" }], "a", "u_derek", "u_derek", mk, "now")).toBeNull();
  });
});

describe("the task view reads, it does nothing (Derek, 2026-10-17)", () => {
  it("says the turn line as words", () => {
    expect(turnSentence("Carol's turn", "need by Fri, Oct 16", "reminded every 3 days")).toBe("Carol's turn, need by Fri, Oct 16, reminded every 3 days");
    expect(turnSentence("Your turn", null, "")).toBe("Your turn");
  });
  it("one quiet line: a draft first", () => {
    expect(stepQuietLine({ draftFor: "Michaella", description: "Make the headers." })).toBe("Draft · not given to Michaella yet · Make the headers.");
  });
  it("one quiet line: sent and waiting", () => {
    expect(stepQuietLine({ description: "Your website changes are done. More words here.", sentAgo: "2d ago", noReply: true })).toBe("Your website changes are done. · sent 2d ago · no reply yet");
  });
  it("one quiet line: the client wrote, with the to dos", () => {
    expect(stepQuietLine({ wrote: { first: "Chelsea", ago: "1h ago" }, description: "ignored", todos: { done: 1, total: 5 } })).toBe("Chelsea wrote 1h ago · 1 of 5 to do");
  });
  it("nothing to say is nothing", () => {
    expect(stepQuietLine({})).toBe("");
  });
});

describe("the step's thread and its latest line (Derek, 2026-10-17)", () => {
  const w = { from: "2026-10-17T10:00:00Z", to: null };
  const nameOf = (id: string) => (id === "u_mich" ? "Michaella" : "Justin");
  const a = (id: string, authorId: string, toId: string | null, body: string, at: string, kind: "team" | "note" | "email" = "team") => ({ id, kind, authorId, toId, body, at });
  it("is the team's messages in the step's window, oldest first", () => {
    const t = stepThread([
      a("2", "u_mich", "u_derek", "Yes, sent Friday", "2026-10-17T12:00:00Z"),
      a("1", "u_derek", "u_mich", "Did this one get sent out?", "2026-10-17T11:00:00Z"),
      a("0", "u_derek", "u_mich", "Before the step", "2026-10-16T11:00:00Z"),
      a("3", "u_derek", null, "An email", "2026-10-17T13:00:00Z", "email"),
    ], w, { meId: "u_derek", nameOf });
    expect(t.map((x) => x.who)).toEqual(["You to Michaella", "Michaella"]);
  });
  it("the latest message reads as one line", () => {
    const t = stepThread([a("1", "u_derek", "u_mich", "Did this one get sent out?\nThanks", "2026-10-17T11:00:00Z")], w, { meId: "u_derek", nameOf });
    expect(latestStepLine(t, () => "just now")).toBe("You to Michaella: Did this one get sent out? · just now");
  });
  it("someone writing to you is just their name; a note is just yours", () => {
    const t = stepThread([a("1", "u_mich", "u_derek", "Yes, sent Friday", "2026-10-17T11:00:00Z"), a("2", "u_derek", null, "Checked", "2026-10-17T12:00:00Z", "note")], w, { meId: "u_derek", nameOf });
    expect(t.map((x) => x.who)).toEqual(["Michaella", "You"]);
    expect(latestStepLine([t[0]], () => "2h ago")).toBe("Michaella: Yes, sent Friday · 2h ago");
  });
  it("none is null", () => {
    expect(latestStepLine([], () => "now")).toBeNull();
  });
});
