import { describe, expect, it } from "vitest";
import { locationFromSaasUrl } from "./saasUrl";

describe("locationFromSaasUrl", () => {
  it("reads the sub account out of a SaaS link", () => {
    expect(locationFromSaasUrl("https://app.gohighlevel.com/v2/location/AbCdEf123456XYZ/dashboard")).toBe("AbCdEf123456XYZ");
    expect(locationFromSaasUrl("https://app.leadconnectorhq.com/v2/location/AbCdEf123456XYZ")).toBe("AbCdEf123456XYZ");
  });
  it("is null without one", () => {
    expect(locationFromSaasUrl("https://acme.com")).toBeNull();
    expect(locationFromSaasUrl(null)).toBeNull();
  });
});
