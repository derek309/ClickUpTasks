import { describe, it, expect } from "vitest";
import { isWebsiteFeedbackReport, clientWordsOfReport } from "./websiteFeedback";

const report = [
  "Now: Call 555 0100\nShould say: Call 555 0199",
  "The phone number here is the old one",
  "---\nShow me on the page: https://pam.com/?cul_show=1\nReported by: Pam\nReported from the website page \"Home\"\nURL: https://pam.com/\nScreen: 390x844",
].join("\n\n");

describe("website feedback reports", () => {
  it("knows a report by its Reported from the website line", () => {
    expect(isWebsiteFeedbackReport(report)).toBe(true);
    expect(isWebsiteFeedbackReport("Please call Pam back about the quote")).toBe(false);
    expect(isWebsiteFeedbackReport("anything", "website_feedback")).toBe(true);
  });

  it("keeps the client's own words and leaves the team's lines off", () => {
    expect(clientWordsOfReport(report)).toBe("Now: Call 555 0100\nShould say: Call 555 0199\n\nThe phone number here is the old one");
  });

  it("gives the whole text back when there is no --- line", () => {
    expect(clientWordsOfReport("  Fix the header  ")).toBe("Fix the header");
  });
});
