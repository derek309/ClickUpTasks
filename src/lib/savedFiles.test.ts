import { describe, expect, it } from "vitest";
import { attachSavedToStep, savedCountLine, savedFileFrom, type ClientLink } from "./data";

const link = (id: string, url: string, label = ""): ClientLink => ({ id, clientId: "cl_a", groupLabel: "", label, url, position: 0, color: "" });
let n = 0;
const makeId = () => `at_${++n}`;

describe("saving a task file to its client", () => {
  it("keeps the same stored file, no copy", () => {
    const f = savedFileFrom({ name: "m and m art.png", kind: "image", size: "1.5 MB", path: "t_1/f_x-m.png" }, "cl_a", 3, "cl_s1")!;
    expect(f).toMatchObject({ clientId: "cl_a", label: "m and m art.png", url: "", path: "t_1/f_x-m.png", kind: "image", size: "1.5 MB", position: 3 });
  });
  it("is not possible for a file with nothing stored", () => {
    expect(savedFileFrom({ name: "x", kind: "link", size: "" }, "cl_a", 0, "cl_s")).toBeNull();
  });
});

describe("putting saved files and links on a step", () => {
  const steps = [{ id: "s1", title: "One", done: false }, { id: "s2", title: "Two", done: false }];
  it("adds a link and a file, each held by the step", () => {
    n = 0;
    const file: ClientLink = { ...link("cl_f", "", "Logo"), path: "t_0/logo.png", kind: "image", size: "20 KB" };
    const r = attachSavedToStep({ attachments: [], subtasks: steps }, "s2", [link("cl_l", "https://drive.google.com/drive/folders/abc", ""), file], makeId);
    expect(r.attachments).toEqual([
      { id: "at_1", name: "Google Drive folder", kind: "link", size: "", url: "https://drive.google.com/drive/folders/abc" },
      { id: "at_2", name: "Logo", kind: "image", size: "20 KB", path: "t_0/logo.png" },
    ]);
    expect(r.subtasks.find((s) => s.id === "s2")!.holds).toEqual(["att:at_1", "att:at_2"]);
    expect([r.links, r.files]).toEqual([1, 1]);
  });
  it("reuses what the task has already", () => {
    const have = [{ id: "at_x", name: "Logo", kind: "image" as const, size: "", path: "t_0/logo.png" }];
    const file: ClientLink = { ...link("cl_f", "", "Logo"), path: "t_0/logo.png", kind: "image" };
    const r = attachSavedToStep({ attachments: have, subtasks: steps }, "s1", [file], makeId);
    expect(r.attachments).toHaveLength(1);
    expect(r.subtasks[0].holds).toEqual(["att:at_x"]);
  });
  it("says what went on", () => {
    expect(savedCountLine(2, 1)).toBe("2 links and 1 file");
    expect(savedCountLine(0, 3)).toBe("3 files");
    expect(savedCountLine(1, 0)).toBe("1 link");
  });
});
