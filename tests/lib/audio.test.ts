import { describe, it, expect } from "vitest";
import { makeAudio } from "@/lib/audio";

describe("audio cues", () => {
  it("exposes the three cue functions", () => {
    const a = makeAudio();
    expect(typeof a.ding).toBe("function");
    expect(typeof a.countdown).toBe("function");
    expect(typeof a.transition).toBe("function");
  });

  it("invocations do not throw", () => {
    // Real chromium provides AudioContext; the cue path actually fires
    // (no audible output in headless mode but the node graph is real).
    const a = makeAudio();
    expect(() => a.ding()).not.toThrow();
    expect(() => a.countdown(0)).not.toThrow();
    expect(() => a.countdown(2)).not.toThrow();
    expect(() => a.transition()).not.toThrow();
  });
});
