import { describe, it, expect } from "vitest";
import { suggestStepActions } from "./stepSuggest";

const kinds = (title: string) => suggestStepActions(title, "Ryan").map((s) => s.kind);
const labels = (title: string) => suggestStepActions(title, "Ryan").map((s) => s.label);

describe("suggestStepActions", () => {
  it("reads a plan and a send as the document then the email, in the name's order", () => {
    expect(labels("Create plan and send to Ryan")).toEqual(["Write the plan", "Email Ryan"]);
    expect(labels("Send Ryan the proposal")).toEqual(["Email Ryan", "Write the proposal"]);
  });
  it("names the document by the title's noun when it has one", () => {
    expect(labels("Write the brief")).toEqual(["Write the brief"]);
    expect(labels("Draft homepage copy")).toEqual(["Write the copy"]);
    expect(labels("Write a blog post")).toEqual(["Write the document"]);
    expect(labels("Document the setup")).toEqual(["Write the document"]);
  });
  it("hears email, reply, tell and let someone know as an email", () => {
    expect(kinds("Email Ryan the dates")).toEqual(["email"]);
    expect(kinds("Reply to Ryan")).toEqual(["email"]);
    expect(kinds("Tell Ryan it is live")).toEqual(["email"]);
    expect(kinds("Let Ryan know the changes are done")).toEqual(["email"]);
  });
  it("an email or text being written is that message, not a document", () => {
    expect(kinds("Draft an email to Ryan")).toEqual(["email"]);
    expect(kinds("Write to Ryan")).toEqual(["email"]);
    expect(kinds("Write a text to Ryan")).toEqual(["text"]);
  });
  it("a text wins over send, but email said outright stays", () => {
    expect(labels("Send Ryan a text")).toEqual(["Text Ryan"]);
    expect(kinds("Text Ryan and email the plan")).toEqual(["text", "email"]);
  });
  it("reads images, pages, videos and checklists", () => {
    expect(labels("Make the thumbnail")).toEqual(["Make the image"]);
    expect(labels("New graphic for Facebook")).toEqual(["Make the image"]);
    expect(labels("Design the logo")).toEqual(["Make the image"]);
    expect(labels("Design the landing page")).toEqual(["Make the web page"]);
    expect(labels("Update the website")).toEqual(["Make the web page"]);
    expect(labels("Edit the video")).toEqual(["Make the video"]);
    expect(labels("Launch checklist")).toEqual(["Add a checklist"]);
  });
  it("suggests nothing new for a call, or for a name with no hint", () => {
    expect(kinds("Call Ryan")).toEqual([]);
    expect(kinds("Look into it")).toEqual([]);
    expect(kinds("")).toEqual([]);
  });
  it("never more than two, and whole words only", () => {
    expect(kinds("Write the plan, make the image, then email Ryan")).toEqual(["doc", "image"]);
    expect(kinds("Check the context of the listing")).toEqual([]);
    expect(kinds("Copy the files over")).toEqual([]);
  });
  it("uses the name it is given for the client", () => {
    expect(suggestStepActions("Send to them", "The Artist Workshop")).toEqual([{ kind: "email", label: "Email The Artist Workshop" }]);
  });
});
