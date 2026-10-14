import { describe, it, expect } from "vitest";
import { orderLists, moveNextTo, moveBy, moveToFirst, sameOrder, placedPosition, PLACED } from "./listOrder";

const ids = ["fruit", "member", "tasks", "web"];

describe("orderLists", () => {
  it("shows A to Z when nobody has rearranged (old positions mean nothing)", () => {
    const lists = [{ name: "Website", position: 0 }, { name: "fruit shed", position: 3 }, { name: "Membership", position: 1 }];
    expect(orderLists(lists).map((l) => l.name)).toEqual(["fruit shed", "Membership", "Website"]);
  });
  it("puts lists placed by hand first, in their order, then the rest A to Z", () => {
    const lists = [
      { name: "Alpha", position: 2 }, { name: "Website", position: placedPosition(0) },
      { name: "Tasks", position: placedPosition(1) }, { name: "Zed", position: undefined }, { name: "Beta", position: null },
    ];
    expect(orderLists(lists).map((l) => l.name)).toEqual(["Website", "Tasks", "Alpha", "Beta", "Zed"]);
  });
  it("does not change the list it was given", () => {
    const lists = [{ name: "B", position: PLACED + 1 }, { name: "A", position: PLACED }];
    orderLists(lists);
    expect(lists[0].name).toBe("B");
  });
});

describe("moveNextTo", () => {
  it("drops before the chip", () => {
    expect(moveNextTo(ids, "web", "member", "before")).toEqual(["fruit", "web", "member", "tasks"]);
    expect(moveNextTo(ids, "tasks", "fruit", "before")).toEqual(["tasks", "fruit", "member", "web"]);
  });
  it("drops after the chip, the last one too", () => {
    expect(moveNextTo(ids, "fruit", "member", "after")).toEqual(["member", "fruit", "tasks", "web"]);
    expect(moveNextTo(ids, "fruit", "web", "after")).toEqual(["member", "tasks", "web", "fruit"]);
  });
  it("leaves the order alone on itself, a neighbour's near side, or an unknown id", () => {
    expect(moveNextTo(ids, "member", "member", "after")).toEqual(ids);
    expect(sameOrder(moveNextTo(ids, "member", "tasks", "before"), ids)).toBe(true);
    expect(sameOrder(moveNextTo(ids, "member", "fruit", "after"), ids)).toBe(true);
    expect(moveNextTo(ids, "nope", "fruit", "before")).toEqual(ids);
    expect(moveNextTo(ids, "fruit", "nope", "before")).toEqual(ids);
  });
});

describe("moveBy and moveToFirst", () => {
  it("steps left and right", () => {
    expect(moveBy(ids, "tasks", -1)).toEqual(["fruit", "tasks", "member", "web"]);
    expect(moveBy(ids, "tasks", 1)).toEqual(["fruit", "member", "web", "tasks"]);
  });
  it("stays put at the ends", () => {
    expect(moveBy(ids, "fruit", -1)).toEqual(ids);
    expect(moveBy(ids, "web", 1)).toEqual(ids);
    expect(moveBy(ids, "nope", 1)).toEqual(ids);
  });
  it("moves to first", () => {
    expect(moveToFirst(ids, "web")).toEqual(["web", "fruit", "member", "tasks"]);
    expect(moveToFirst(ids, "fruit")).toEqual(ids);
    expect(moveToFirst(ids, "nope")).toEqual(ids);
  });
});
