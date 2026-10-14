import { describe, it, expect } from "vitest";
import { suggestStepActions } from "./stepSuggest";

const kinds = (title: string) => suggestStepActions(title, "Ryan").map((s) => s.kind);
const labels = (title: string) => suggestStepActions(title, "Ryan").map((s) => s.label);

describe("suggestStepActions", () => {
  it("offers one thing only, the first the name points to", () => {
    expect(labels("Create plan and send to Ryan")).toEqual(["Write the plan"]);
    expect(labels("Send Ryan the proposal")).toEqual(["Email Ryan"]);
    expect(kinds("Write the plan, make the image, then email Ryan")).toEqual(["doc"]);
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
    expect(kinds("Text Ryan and email the plan")).toEqual(["text"]);
    expect(kinds("Email the plan, then text Ryan")).toEqual(["email"]);
  });
  it("names an image or a video by the word the name uses", () => {
    expect(labels("Make the thumbnail")).toEqual(["Make the thumbnail"]);
    expect(labels("New graphic for Facebook")).toEqual(["Make the graphic"]);
    expect(labels("Design the logo")).toEqual(["Make the design"]);
    expect(labels("Edit the video")).toEqual(["Make the video"]);
    expect(labels("New images for the gallery")).toEqual(["Make the image"]);
  });
  it("reads a page as the HTML review to build, and a checklist", () => {
    expect(labels("Design the landing page")).toEqual(["Build the HTML review"]);
    expect(labels("Update the website")).toEqual(["Build the HTML review"]);
    expect(labels("Launch checklist")).toEqual(["Add a checklist"]);
  });
  it("suggests nothing new for a call, or for a name with no hint", () => {
    expect(kinds("Call Ryan")).toEqual([]);
    expect(kinds("Look into it")).toEqual([]);
    expect(kinds("")).toEqual([]);
  });
  it("whole words only", () => {
    expect(kinds("Check the context of the listing")).toEqual([]);
    expect(kinds("Copy the files over")).toEqual([]);
  });
  it("reads a newsletter as the HTML review only, never an email to the client", () => {
    expect(labels("Newsletter for October")).toEqual(["Build the HTML review"]);
    expect(labels("Create newsletter")).toEqual(["Build the HTML review"]);
    expect(labels("Send the October newsletter")).toEqual(["Build the HTML review"]);
  });
  it("reads a blast or a campaign as an email, unless it is a text", () => {
    expect(kinds("Spring blast")).toEqual(["email"]);
    expect(kinds("Holiday campaign")).toEqual(["email"]);
    expect(kinds("Text blast")).toEqual(["text"]);
  });
  it("reads a post, a blog and an article as a document", () => {
    expect(labels("Blog for March")).toEqual(["Write the document"]);
    expect(kinds("Facebook post")).toEqual(["doc"]);
    expect(kinds("Article on spring cleanups")).toEqual(["doc"]);
  });
  it("reads a flyer, a postcard, a banner and an ad as that image", () => {
    expect(labels("Open house flyer")).toEqual(["Make the flyer"]);
    expect(labels("Postcard for the mailer")).toEqual(["Make the postcard"]);
    expect(labels("Banner for the event")).toEqual(["Make the banner"]);
    expect(labels("Facebook ad")).toEqual(["Make the ad"]);
    expect(labels("Facebook ads for spring")).toEqual(["Make the ad"]);
    expect(kinds("Add the address")).toEqual([]);
  });
  it("reads a landing, a site and a website as the HTML review", () => {
    expect(labels("Landing for the offer")).toEqual(["Build the HTML review"]);
    expect(kinds("Fix the site")).toEqual(["page"]);
    expect(kinds("New website")).toEqual(["page"]);
  });
  it("reads a reel and a clip as that video", () => {
    expect(labels("Instagram reel")).toEqual(["Make the reel"]);
    expect(labels("Cut a clip from the interview")).toEqual(["Make the clip"]);
  });
  it("reads follow up and remind as an email", () => {
    expect(labels("Follow up with Ryan")).toEqual(["Email Ryan"]);
    expect(kinds("Remind Ryan about the photos")).toEqual(["email"]);
  });
  it("takes whichever the name says first", () => {
    expect(kinds("Flyer and a reel for the open house")).toEqual(["image"]);
    expect(kinds("Reel, then the flyer, then a blog post")).toEqual(["video"]);
    expect(kinds("Blog post, then follow up")).toEqual(["doc"]);
  });
  it("uses the name it is given for the client", () => {
    expect(suggestStepActions("Send to them", "The Artist Workshop")).toEqual([{ kind: "email", label: "Email The Artist Workshop" }]);
  });
});
