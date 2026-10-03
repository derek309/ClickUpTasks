import { describe, it, expect } from "vitest";
import { linksOnTask } from "./inboxModel";

describe("links on a task, for Insert from task", () => {
  it("keeps a link's words, names a bare address, newest note first, no events", () => {
    const task = {
      description: `<p>See the <a href="https://n4ubpt72so.wpdns.site/r/abc?x=1&amp;y=2">sneak peek</a></p>`,
      comments: [
        { kind: "comment", body: "Old one https://example.com/old." },
        { kind: "event", body: "moved https://skip.me" },
        { kind: "comment", body: "Logo is at https://www.drive.example.com/logo/" },
      ],
    };
    expect(linksOnTask(task)).toEqual([
      { url: "https://www.drive.example.com/logo/", label: "drive.example.com/logo" },
      { url: "https://example.com/old", label: "example.com/old" },
      { url: "https://n4ubpt72so.wpdns.site/r/abc?x=1&y=2", label: "sneak peek" },
    ]);
  });
  it("is empty on a task without links", () => {
    expect(linksOnTask({ description: "<p>Nothing here</p>", comments: [] })).toEqual([]);
  });
});
