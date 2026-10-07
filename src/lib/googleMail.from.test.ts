import { describe, it, expect } from "vitest";
import { parseFrom } from "./googleMail";

// Derek, 2026-10-07: the app's own notification, From a bare
// derek@clickuplocal.com, showed in the Inbox as "dere" <k@clickuplocal.com>.
describe("parseFrom", () => {
  it("keeps a bare address whole", () => {
    expect(parseFrom("derek@clickuplocal.com")).toEqual({ name: "", email: "derek@clickuplocal.com" });
  });
  it("reads a name and an address", () => {
    expect(parseFrom('"Pamela Macias" <Pam@Example.com>')).toEqual({ name: "Pamela Macias", email: "pam@example.com" });
    expect(parseFrom("ClickUpTasks <derek@clickuplocal.com>")).toEqual({ name: "ClickUpTasks", email: "derek@clickuplocal.com" });
  });
  it("reads an address in angle brackets with no name", () => {
    expect(parseFrom("<amanda@example.com>")).toEqual({ name: "", email: "amanda@example.com" });
  });
});
