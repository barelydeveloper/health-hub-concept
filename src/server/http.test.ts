import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageParams } from "./http";

describe("cursors", () => {
  it("round-trips a cursor and drops oversized or undated values", () => {
    const cursor = encodeCursor("2026-10-10T15:00:00.000Z", "clxyz");
    expect(decodeCursor(cursor)).toEqual({ at: "2026-10-10T15:00:00.000Z", id: "clxyz" });
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("a".repeat(1025))).toBeNull();
    expect(decodeCursor(Buffer.from("not-a-date\nrow").toString("base64url"))).toBeNull();
  });

  it("caps page size", () => {
    const page = pageParams(new URL("http://localhost/api/v1/workouts?limit=9999&cursor=%%%"));
    expect(page.limit).toBe(100);
    expect(page.cursor).toBeNull();
  });
});
