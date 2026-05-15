/**
 * Procedural Web Audio cues. Ported from eagle/src/audio-cues.js.
 * Three exports: ding (half/30s/10s), countdown (T-3/T-2/T-1),
 * transition (advance). Singleton AudioContext + DynamicsCompressor.
 */

export interface AudioCues {
  ding: () => void;
  countdown: (step: 0 | 1 | 2) => void;
  transition: () => void;
}

interface State {
  ctx: AudioContext;
  comp: DynamicsCompressorNode;
}
let state: State | null = null;

function ensureCtx(): State | null {
  if (typeof window === "undefined") return null;
  if (state) {
    if (state.ctx.state === "suspended") void state.ctx.resume();
    return state;
  }
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  comp.connect(ctx.destination);
  state = { ctx, comp };
  return state;
}

// Schedules a tone at startAt (in audio-context seconds). Callers pass either
// ctx.currentTime for "play now" or currentTime + offset for "play in N seconds".
// Scheduling on the audio clock avoids JS-timer jitter for layered cues.
function playToneAt(
  startAt: number,
  freq: number,
  durationS: number,
  volume: number,
  type: OscillatorType,
): void {
  const s = ensureCtx();
  if (!s) return;
  const { ctx, comp } = s;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // 5ms attack, 30ms hold, exponential decay
  g.gain.setValueAtTime(0, startAt);
  g.gain.linearRampToValueAtTime(volume, startAt + 0.005);
  g.gain.setValueAtTime(volume, startAt + 0.035);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS);
  osc.connect(g).connect(comp);
  osc.start(startAt);
  osc.stop(startAt + durationS + 0.02);
}

function now(): number {
  const s = ensureCtx();
  return s ? s.ctx.currentTime : 0;
}

// Eagle's bell helper: base tone + octave layer at dur*0.7 and vol*0.3.
function bell(freq: number, durationS: number, volume: number): void {
  const t = now();
  playToneAt(t, freq, durationS, volume, "triangle");
  playToneAt(t, freq * 2, durationS * 0.7, volume * 0.3, "sine");
}

export function makeAudio(): AudioCues {
  return {
    ding: () => bell(880, 0.55, 0.55),
    countdown: (step) => {
      const freqs = [660, 784, 988] as const;
      if (step === 2) {
        bell(freqs[2], 0.35, 0.6);
      } else {
        playToneAt(now(), freqs[step], 0.18, 0.45, "triangle");
      }
    },
    transition: () => {
      // Both tones scheduled on the audio clock, 0.09s apart, so layering is
      // sample-accurate even under heavy main-thread load.
      const t = now();
      playToneAt(t, 523.25, 0.18, 0.4, "triangle");        // C5
      playToneAt(t + 0.09, 784, 0.25, 0.45, "triangle");   // G5
    },
  };
}
