import { describe, expect, it } from "vitest";
import { evaluateOpeningStatus } from "@/lib/opening-hours";

describe("evaluateOpeningStatus", () => {
  it("returns open for 24/7 schedules", () => {
    expect(evaluateOpeningStatus("24/7", new Date("2026-01-12T12:00:00Z"))).toBe("open");
  });

  it("parses regular weekday ranges", () => {
    const open = evaluateOpeningStatus("Mo-Fr 09:00-18:00", new Date("2026-01-12T09:30:00Z"));
    const closed = evaluateOpeningStatus("Mo-Fr 09:00-18:00", new Date("2026-01-12T19:30:00Z"));
    expect(open).toBe("open");
    expect(closed).toBe("closed");
  });

  it("keeps weekday ranges active across Tu-We-Th (regression for Mo-Fr parsing)", () => {
    const openTuesday = evaluateOpeningStatus("Mo-Fr 09:00-18:00", new Date("2026-01-13T11:00:00Z"));
    const openWednesday = evaluateOpeningStatus("Mo-Fr 09:00-18:00", new Date("2026-01-14T11:00:00Z"));
    const openThursday = evaluateOpeningStatus("Mo-Fr 09:00-18:00", new Date("2026-01-15T11:00:00Z"));
    expect(openTuesday).toBe("open");
    expect(openWednesday).toBe("open");
    expect(openThursday).toBe("open");
  });

  it("supports overnight ranges across midnight", () => {
    const openOvernight = evaluateOpeningStatus("Fr 22:00-02:00", new Date("2026-01-10T00:30:00Z"));
    const closedAfter = evaluateOpeningStatus("Fr 22:00-02:00", new Date("2026-01-10T03:30:00Z"));
    expect(openOvernight).toBe("open");
    expect(closedAfter).toBe("closed");
  });

  it("returns unknown when schedule is missing or unparsable", () => {
    expect(evaluateOpeningStatus("", new Date("2026-01-12T12:00:00Z"))).toBe("unknown");
    expect(evaluateOpeningStatus("by appointment only", new Date("2026-01-12T12:00:00Z"))).toBe("unknown");
    expect(evaluateOpeningStatus("Mo-Fr", new Date("2026-01-12T12:00:00Z"))).toBe("unknown");
  });
});
