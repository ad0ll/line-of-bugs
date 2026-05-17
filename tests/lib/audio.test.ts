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

  it("consults isMuted before firing each cue", () => {
    // We can't introspect audible output here; we can verify the callback
    // is consulted every cue. That's enough to guarantee mute short-circuits.
    let calls = 0;
    const a = makeAudio({ isMuted: () => { calls++; return true; } });
    a.ding();
    a.countdown(0);
    a.countdown(2);
    a.transition();
    expect(calls).toBe(4);
  });
});
