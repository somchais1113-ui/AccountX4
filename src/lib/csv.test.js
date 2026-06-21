import { describe, expect, it } from "vitest";
import { normalizeFinancialCSV, parseNumber } from "./csv.js";

describe("financial CSV", () => {
  it("parses currency symbols, grouping commas, and accounting negatives", () => {
    expect(parseNumber("฿1,250.50")).toBe(1250.5);
    expect(parseNumber("(2,000)")).toBe(-2000);
  });

  it("parses quoted CSV values", () => {
    const rows = normalizeFinancialCSV('month,revenue,expense\n1,"1,200","(300)"');
    expect(rows[0]).toMatchObject({monthIdx: 0, revenue: 1200, expense: -300});
  });

  it("rejects duplicate months", () => {
    expect(() => normalizeFinancialCSV("month,revenue\n1,10\n1,20", "en")).toThrow("Duplicate month 1");
  });

  it("rejects months outside 1-12", () => {
    expect(() => normalizeFinancialCSV("month,revenue\n13,10", "en")).toThrow("must be 1-12");
  });
});
