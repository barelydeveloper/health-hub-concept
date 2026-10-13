import { describe, expect, it } from "vitest";
import { toInches, toPounds } from "./units";

describe("unit conversion", () => {
  it("converts kilograms to pounds and leaves pounds unchanged", () => {
    expect(toPounds(69.127, "kg")).toBeCloseTo(152.399, 2);
    expect(toPounds(151, "lb")).toBe(151);
  });

  it("converts centimeters to inches", () => {
    expect(toInches(2.54, "cm")).toBeCloseTo(1, 5);
    expect(toInches(28, "in")).toBe(28);
  });

  it("rejects unknown units", () => {
    expect(() => toPounds(1, "stone")).toThrow(/Unsupported mass unit/);
    expect(() => toInches(1, "ft")).toThrow(/Unsupported length unit/);
  });
});
