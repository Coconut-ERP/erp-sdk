import { describe, expect, it } from "vitest";
import { DataFrame } from "../src/frame";

const rows = [
  { customer: "An", status: "approved", total: 100 },
  { customer: "Bình", status: "draft", total: 50 },
  { customer: "An", status: "approved", total: 200 },
  { customer: "Chi", status: "approved", total: 75 },
];

describe("DataFrame", () => {
  it("filters with where operators", () => {
    const df = DataFrame.from(rows);
    expect(df.where("status", "equals", "approved").count()).toBe(3);
    expect(df.where("total", "greater_than", 75).count()).toBe(2);
    expect(df.where("customer", "contains", "an").count()).toBe(2);
    expect(df.where("status", "is_empty").count()).toBe(0);
  });

  it("matches in/not_in against a list, the same set the server would", () => {
    const df = DataFrame.from(rows);
    expect(df.where("status", "in", ["approved", "paid"]).count()).toBe(3);
    expect(df.where("status", "not_in", ["approved"]).pluck("customer")).toEqual(["Bình"]);
    expect(df.where("total", "in", [50, 200]).pluck("total")).toEqual([50, 200]);
    // A row with no value is not one of the excluded values, so it stays.
    expect(
      DataFrame.from([{ status: null }]).where("status", "not_in", ["approved"]).count(),
    ).toBe(1);
  });

  it("sorts and selects", () => {
    const sorted = DataFrame.from(rows).sortBy("total", "desc");
    expect(sorted.pluck("total")).toEqual([200, 100, 75, 50]);
    expect(sorted.select("customer").first()).toEqual({ customer: "An" });
  });

  it("aggregates", () => {
    const df = DataFrame.from(rows);
    expect(df.sum("total")).toBe(425);
    expect(df.avg("total")).toBeCloseTo(106.25);
    expect(df.min("total")).toBe(50);
    expect(df.max("total")).toBe(200);
    expect(df.countBy("status")).toEqual({ approved: 3, draft: 1 });
  });

  it("groups and aggregates", () => {
    const result = DataFrame.from(rows)
      .groupBy("customer")
      .agg({ revenue: ["sum", "total"], orders: ["count"] })
      .sortBy("revenue", "desc")
      .toArray();
    expect(result).toEqual([
      { customer: "An", revenue: 300, orders: 2 },
      { customer: "Chi", revenue: 75, orders: 1 },
      { customer: "Bình", revenue: 50, orders: 1 },
    ]);
  });

  it("joins on a key", () => {
    const regions = DataFrame.from([
      { customer: "An", region: "HN" },
      { customer: "Bình", region: "HCM" },
    ]);
    const joined = DataFrame.from(rows).leftJoin(regions, "customer");
    expect(joined.where("region", "equals", "HN").count()).toBe(2);
    expect(joined.where("region", "is_empty").pluck("customer")).toEqual(["Chi"]);
  });

  it("chains immutably", () => {
    const df = DataFrame.from(rows);
    df.where("status", "equals", "draft");
    expect(df.count()).toBe(4);
  });
});
