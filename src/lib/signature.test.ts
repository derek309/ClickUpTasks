import { describe, it, expect } from "vitest";
import { guessFromSignature } from "./signature";

const russell = `Good morning,

I asked Wendy to connect us because we are updating our web page.

Russell Lathrop/ GIS Operations Manager
Russell@whitmanlandgroup.com

Whitman Land Group, LLC
Dallas: 972.318.9688 - Houston: 832.730.5321
San Antonio: 210.634.1736 - Austin: 512-580-4979
whitmanlandgroup.com

On Thu, Oct 1, 2026 at 9:59 AM Justin Chevallier <justin@clickuplocal.com> wrote:
> Hi Russell, great to meet you`;

describe("reading an email signature", () => {
  it("finds the title, company, first phone and website", () => {
    const g = guessFromSignature(russell, { name: "Russell Lathrop", email: "russell@whitmanlandgroup.com" });
    expect(g).toEqual({
      firstName: "Russell", lastName: "Lathrop", title: "GIS Operations Manager",
      companyName: "Whitman Land Group, LLC", phone: "972.318.9688", website: "whitmanlandgroup.com",
    });
  });

  it("takes the title from the line under the name", () => {
    const g = guessFromSignature("Thanks!\n\nKelly Molloy\nMarketing Director\nAcme Realty\n(916) 555-0142", { name: "Kelly Molloy", email: "kelly@acmerealty.com" });
    expect(g.title).toBe("Marketing Director");
    expect(g.companyName).toBe("Acme Realty");
    expect(g.phone).toBe("(916) 555-0142");
    expect(g.website).toBe("acmerealty.com");
  });

  it("guesses nothing it can't see, and no website for free mail", () => {
    const g = guessFromSignature("ok sounds good", { name: "Bob", email: "bob@gmail.com" });
    expect(g).toEqual({ firstName: "Bob", lastName: "", title: "", companyName: "", phone: "", website: "" });
  });
});
