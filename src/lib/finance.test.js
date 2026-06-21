import { describe, expect, it } from "vitest";
import { FinanceMath, convertToTHB } from "./finance.js";

describe("FinanceMath", () => {
  it("calculates MOM and handles a zero comparison base", () => {
    expect(FinanceMath.MOM(120, 100)).toBe(20);
    expect(FinanceMath.MOM(120, 0)).toBeNull();
  });

  it("does not calculate QOQ before a previous quarter exists", () => {
    const rows = Array.from({length: 12}, (_, index) => ({revenue: index + 1}));
    expect(FinanceMath.QOQ(rows, "revenue", 0)).toBeNull();
    expect(FinanceMath.QOQ(rows, "revenue", 1)).toBeCloseTo(150);
  });

  it("converts currencies only when a valid rate exists", () => {
    expect(convertToTHB(100, "THB", {})).toBe(100);
    expect(convertToTHB(100, "USD", {USD: 36.5})).toBe(3650);
    expect(convertToTHB(100, "USD", {})).toBeNull();
  });
});
