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
