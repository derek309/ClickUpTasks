import { describe, it, expect } from "vitest";
import { defaultQueueAt, placeNewTask, previewPlace, queueAtWords, deadlineWords } from "./newTaskQueue";
import { groupQueue, type QTask } from "../../mcp/queue.mjs";

// The new task box on a queue list (Derek, 2026-10-14): where the task joins
// the line, by its priority unless picked, and the one date it can carry.

const S = { now: 1, spacing: 3 };
const TODAY = "2026-10-14";
const t = (id: string, pos: number | null, over: Partial<QTask> = {}): QTask => ({ id, title: id, status: "todo", due: null, queuePos: pos, createdAt: "2026-10-01", priority: "normal", subtasks: [], ...over });
// Now (dated), then two waiting in line.
const line = () => [t("a", 1000, { due: "2026-10-16" }), t("b", 2000), t("c", 3000)];
const fresh = (over: Partial<QTask> = {}) => t("n", null, { createdAt: "2026-10-14", ...over });

describe("where it joins by default", () => {
  it("follows the priority: urgent and a client request next up, the rest at the bottom", () => {
    expect(defaultQueueAt("urgent")).toBe("next");
    expect(defaultQueueAt("client_request")).toBe("next");
    expect(defaultQueueAt("conversation")).toBe("next");
    expect(defaultQueueAt("normal")).toBe("bottom");
    expect(defaultQueueAt(undefined)).toBe("bottom");
  });
});

describe("placing it", () => {
  const order = (list: QTask[], self: { queuePos?: number | null }) =>
    [...list, { ...fresh(), queuePos: self.queuePos ?? null }].sort((x, y) => (x.queuePos ?? 0) - (y.queuePos ?? 0)).map((x) => x.id);

  it("at the bottom: last in line, no date", () => {
    const { self, others } = placeNewTask(line(), S, fresh(), "bottom", TODAY);
    expect(order(line(), self)).toEqual(["a", "b", "c", "n"]);
    expect(self.due).toBeUndefined();
    expect(others).toEqual([]);
  });

  it("next up: the top of Up next, right after Now", () => {
    const { self } = placeNewTask(line(), S, fresh(), "next", TODAY);
    expect(order(line(), self)).toEqual(["a", "n", "b", "c"]);
  });

  it("now: first in line and dated today", () => {
    const { self } = placeNewTask(line(), S, fresh(), "now", TODAY);
    expect(order(line(), self)).toEqual(["n", "a", "b", "c"]);
    expect(self.due).toBe(TODAY);
    expect(self.queueSavedDue).toBeNull();
  });

  it("not picked: an urgent one goes where its priority puts it", () => {
    const { self } = placeNewTask(line(), S, fresh({ priority: "urgent" }), null, TODAY);
    expect(order(line(), self)).toEqual(["a", "n", "b", "c"]);
  });

  it("into an empty line it is Now at once and gets its date from the spacing", () => {
    const { self } = placeNewTask([], S, fresh(), null, TODAY);
    expect(self.queuePos).not.toBeNull();
    expect(self.due).toBe("2026-10-19");
  });

  it("a deadline keeps its date, wherever it goes", () => {
    const { self } = placeNewTask(line(), S, fresh({ due: "2026-10-30", deadline: true }), "bottom", TODAY);
    expect(self.due).toBeUndefined();
    expect(self.queueSavedDue).toBeUndefined();
    const placed = [...line(), { ...fresh({ due: "2026-10-30", deadline: true }), queuePos: self.queuePos }];
    expect(groupQueue(placed, S).upNext.find((u) => u.task.id === "n")?.task.due).toBe("2026-10-30");
  });
});

describe("the sentence's words", () => {
  it("names the place each choice gives", () => {
    expect(previewPlace(line(), S, fresh(), "bottom", TODAY)).toEqual({ place: 4, now: false });
    expect(previewPlace(line(), S, fresh(), "next", TODAY)).toEqual({ place: 2, now: false });
    expect(previewPlace(line(), S, fresh(), "now", TODAY).now).toBe(true);
    expect(queueAtWords("bottom", 9)).toBe("at the bottom (9th)");
    expect(queueAtWords("next", 2)).toBe("next up (2nd)");
    expect(queueAtWords("next", 3)).toBe("next up (3rd)");
    expect(queueAtWords("bottom", 11)).toBe("at the bottom (11th)");
    expect(queueAtWords("now")).toBe("now");
  });

  it("a deadline reads as its date", () => {
    expect(deadlineWords("2026-10-30")).toBe("deadline Oct 30");
  });
});
