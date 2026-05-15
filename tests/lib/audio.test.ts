import { describe, it, expect } from "vitest";
import { makeAudio } from "@/lib/audio";

describe("audio cues", () => {
  it("exposes the three cue functions", () => {
    const a = makeAudio();
    expect(typeof a.ding).toBe("function");
    expect(typeof a.countdown).toBe("function");
    expect(typeof a.transition).toBe("function");
  });

  it("calls do not throw in a no-AudioContext environment", () => {
    // happy-dom has no AudioContext; functions should no-op safely
    const a = makeAudio();
    expect(() => a.ding()).not.toThrow();
    expect(() => a.countdown(0)).not.toThrow();
    expect(() => a.countdown(2)).not.toThrow();
    expect(() => a.transition()).not.toThrow();
  });
});
