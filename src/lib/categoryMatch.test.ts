import { describe, it, expect } from "vitest";
import { categoriesMatch, matchesAnyCategory } from "./categoryMatch";

describe("categoriesMatch (theme category vs real GD category, different vocabularies)", () => {
  it("matches on shared significant words, even when the phrases aren't identical", () => {
    expect(categoriesMatch("Coffee and Cafes", "Coffee Shops")).toBe(true);
    expect(categoriesMatch("Bakeries and Sweet Shops", "Bakeries")).toBe(true);
    expect(categoriesMatch("Craft Breweries and Taprooms", "Breweries")).toBe(true);
  });
  it("matches identical or containing strings regardless of case", () => {
    expect(categoriesMatch("Bakeries", "bakeries")).toBe(true);
    expect(categoriesMatch("Bakery", "Bakeries")).toBe(true); // substring containment fallback
  });
  it("does not match genuinely unrelated categories", () => {
    expect(categoriesMatch("Local Makers", "Golf Courses")).toBe(false);
    expect(categoriesMatch("Specialty Retail", "Dentistry")).toBe(false);
  });
  it("ignores stopwords so they never produce a false match", () => {
    expect(categoriesMatch("Shops and Stores", "Restaurants and Bars")).toBe(false);
  });
  it("handles empty input safely", () => {
    expect(categoriesMatch("", "Coffee Shops")).toBe(false);
    expect(categoriesMatch("Coffee", "")).toBe(false);
  });
});

describe("categoriesMatch ignores generic shop/bar/store/center/service/market words", () => {
  // Real false positives reported live: a "Coffee Shops and Cafes" /
  // "Juice Bars and Smoothies" theme was pulling in an auto body shop, a
  // tire shop, a bike shop, a florist, sports bars, and a wine bar — all
  // via the shared generic word "shop" or "bar", with no real relation to
  // coffee or juice.
  it("does not match on 'shop' alone", () => {
    expect(categoriesMatch("Coffee Shops and Cafes", "Body Shops & Collision Repair")).toBe(false);
    expect(categoriesMatch("Coffee Shops and Cafes", "Tire Shops")).toBe(false);
    expect(categoriesMatch("Coffee Shops and Cafes", "Bicycle Shops")).toBe(false);
    expect(categoriesMatch("Coffee Shops and Cafes", "Florists & Gift Shops")).toBe(false);
  });
  it("does not match on 'bar' alone", () => {
    expect(categoriesMatch("Juice Bars and Smoothies", "Sports Bars")).toBe(false);
    expect(categoriesMatch("Juice Bars and Smoothies", "Wine Bars")).toBe(false);
    expect(categoriesMatch("Juice Bars and Smoothies", "Bar & Grill")).toBe(false);
  });
  it("still matches when a real distinguishing word overlaps", () => {
    expect(categoriesMatch("Coffee Shops and Cafes", "Coffee Shops")).toBe(true);
    expect(categoriesMatch("Coffee Shops and Cafes", "Cafés & Coffee Shops")).toBe(true);
  });
});

describe("matchesAnyCategory", () => {
  it("matches if any theme category fuzzy-matches", () => {
    expect(matchesAnyCategory("Coffee Shops", ["Specialty Retail", "Coffee and Cafes", "Bakeries"])).toBe(true);
  });
  it("returns false when nothing matches", () => {
    expect(matchesAnyCategory("Golf Courses", ["Specialty Retail", "Coffee and Cafes", "Bakeries"])).toBe(false);
  });
  it("treats an empty theme category list as matching everything", () => {
    expect(matchesAnyCategory("Golf Courses", [])).toBe(true);
  });
});
