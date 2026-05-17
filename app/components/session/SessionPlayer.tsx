"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Image } from "@/db/schema";
import { useHighResTimer } from "@/lib/hooks/useHighResTimer";
import { useMuted } from "@/lib/hooks/useMuted";
import { makeAudio, type AudioCues } from "@/lib/audio";
import { createPreloadManager, type PreloadManager } from "@/lib/preload-manager";
import { T } from "@/lib/tokens";
import { Timer } from "./Timer";
import { ProgressBar } from "./ProgressBar";
import { SessionImage } from "./SessionImage";
import { SourceInfoChip } from "./SourceInfoChip";
import { SessionActionBar, type MagnifierSize } from "./SessionActionBar";
import { EdgePrevNext } from "./EdgePrevNext";
import { Magnifier } from "./Magnifier";
import { EndOfSessionOverlay } from "./EndOfSessionOverlay";
import { SessionTitle } from "./SessionTitle";
import { SketchfabBrowsePanel, fetchSketchfab, sketchfabQueryKey, useSketchfabAvailability } from "./SketchfabBrowsePanel";

interface Props {
  items: Image[];
  initialIntervalSec: number;
}

const MAG_CYCLE: MagnifierSize[] = ["off", "S", "M", "L", "XL"];

export function SessionPlayer({ items, initialIntervalSec }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [intervalSec, setIntervalSec] = useState(initialIntervalSec);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [bw, setBw] = useState(false);
  const [magnifier, setMagnifier] = useState<MagnifierSize>("off");
  const [done, setDone] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sketchfabOpen, setSketchfabOpen] = useState(false);
  const [muted, setMuted] = useMuted();
  // Ref-mirror so the audio module's isMuted callback reads the current value
  // without forcing us to rebuild AudioCues every render.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const canBrowseSketchfab =
    !!items[idx]?.taxonSpecies && !!items[idx]?.commonName;
  const toggleSketchfab = useCallback(() => {
    // Only flip true when the panel can actually render; always allow closing.
    setSketchfabOpen((open) => (open ? false : canBrowseSketchfab));
  }, [canBrowseSketchfab]);
  const sketchfabAvailable = useSketchfabAvailability(
    items[idx]?.taxonSpecies ?? "",
    items[idx]?.commonName ?? "",
  );

  const qc = useQueryClient();

  const prefetchSketchfab = useCallback(
    (sci: string | null | undefined, com: string | null | undefined) => {
      if (!sci || !com) return;
      void qc.prefetchQuery({
        queryKey: sketchfabQueryKey(sci, com),
        queryFn: ({ signal }) => fetchSketchfab(sci, com, signal),
        staleTime: 10 * 60_000,
        gcTime: 20 * 60_000,
      });
    },
    [qc],
  );

  useEffect(() => {
    prefetchSketchfab(items[idx]?.taxonSpecies, items[idx]?.commonName);
  }, [items, idx, prefetchSketchfab]);

  useEffect(() => {
    prefetchSketchfab(items[idx + 1]?.taxonSpecies, items[idx + 1]?.commonName);
  }, [items, idx, prefetchSketchfab]);

  // Track fullscreen state — user may exit via Escape (handled by browser, not us)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const audioRef = useRef<AudioCues | null>(null);
  const preloadRef = useRef<PreloadManager | null>(null);
  const firedCuesRef = useRef<Set<string>>(new Set());
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `idx` for callbacks that need the current index without taking
  // it as a dependency (advance/goNext/goPrev should remain stable refs).
  const idxRef = useRef<number>(0);
  useEffect(() => {
    idxRef.current = idx;
  }, [idx]);

  // Initialize audio + preload once
  useEffect(() => {
    audioRef.current = makeAudio({ isMuted: () => mutedRef.current });
    // Preload the medium tier (1024px) — same tier SessionImage actually
    // displays. Using full-res here would warm the wrong cache and we'd
    // still wait on /api/medium for the visible <img>.
    preloadRef.current = createPreloadManager((id) => {
      const item = items.find((it) => it.imageId === id);
      return item ? `/api/medium/${item.filename.replace(/^images\//, "")}` : "";
    });
    preloadRef.current.setQueue(items.map((it) => it.imageId));
  }, [items]);

  // On slide change: reset per-slide state + preload next + mark current used
  useEffect(() => {
    setElapsedMs(0);
    firedCuesRef.current = new Set();
    if (preloadRef.current && items[idx]) {
      preloadRef.current.onIndexChange(idx);
      preloadRef.current.markUsed(items[idx]!.imageId);
    }
  }, [idx, items]);

  const durationMs = intervalSec * 1000;

  const advance = useCallback(() => {
    // Side effects (audio cue, done flag) live outside the setIdx updater so
    // React StrictMode double-invocation can't fire them twice.
    audioRef.current?.transition();
    const cur = idxRef.current;
    if (cur + 1 >= items.length) {
      setDone(true);
      return;
    }
    setIdx(cur + 1);
  }, [items.length]);

  const goPrev = useCallback(() => {
    setIdx((cur) => Math.max(0, cur - 1));
  }, []);

  const goNext = useCallback(() => {
    setIdx((cur) => Math.min(items.length - 1, cur + 1));
  }, [items.length]);

  const onTick = useCallback(
    (elapsed: number) => {
      setElapsedMs(elapsed);
      const audio = audioRef.current;
      if (!audio) return;
      const remaining = durationMs - elapsed;
      const fired = firedCuesRef.current;
      if (durationMs >= 60_000 && elapsed >= durationMs / 2 && !fired.has("half")) {
        audio.ding();
        fired.add("half");
      }
      if (remaining <= 30_000 && remaining > 10_000 && !fired.has("30s")) {
        audio.ding();
        fired.add("30s");
      }
      if (remaining <= 10_000 && remaining > 3_000 && !fired.has("10s")) {
        audio.ding();
        fired.add("10s");
      }
      if (remaining <= 3_000 && remaining > 2_000 && !fired.has("3")) {
        audio.countdown(0);
        fired.add("3");
      }
      if (remaining <= 2_000 && remaining > 1_000 && !fired.has("2")) {
        audio.countdown(1);
        fired.add("2");
      }
      if (remaining <= 1_000 && remaining > 0 && !fired.has("1")) {
        audio.countdown(2);
        fired.add("1");
      }
    },
    [durationMs],
  );

  // resetKey combines idx + intervalSec so a mid-slide interval change resets the
  // accumulator. The report modal pauses the underlying session per spec §10.
  const reportModalOpen = pathname.startsWith("/report/");
  useHighResTimer(
    durationMs,
    !paused && !done && !reportModalOpen && !sketchfabOpen,
    onTick,
    advance,
    `${idx}-${intervalSec}`,
  );

  // Chrome auto-hide (mousemove → reset 2s timer). Force-show while modal open.
  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    if (reportModalOpen || sketchfabOpen) return;
    chromeTimerRef.current = setTimeout(() => setChromeVisible(false), T.durationChromeHide);
  }, [reportModalOpen, sketchfabOpen]);

  useEffect(() => {
    if (reportModalOpen) {
      setChromeVisible(true);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    }
  }, [reportModalOpen]);

  useEffect(() => {
    if (sketchfabOpen) {
      setChromeVisible(true);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    }
  }, [sketchfabOpen]);

  useEffect(() => {
    bumpChrome();
    const onActivity = () => bumpChrome();
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("focusin", onActivity);
    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("focusin", onActivity);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, [bumpChrome]);

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable) return;
      // Holding an arrow key would otherwise auto-repeat at the OS rate and
      // race past the preload manager. Slide changes should be discrete.
      if (e.repeat && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case " ":
          e.preventDefault();
          setPaused((p) => !p);
          break;
        case "b":
        case "B":
          setBw((v) => !v);
          break;
        case "z":
        case "Z":
          setMagnifier((cur) => {
            const i = MAG_CYCLE.indexOf(cur);
            return MAG_CYCLE[(i + 1) % MAG_CYCLE.length]!;
          });
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "r":
        case "R":
          if (!pathname.startsWith("/report/")) {
            router.push(`/report/${encodeURIComponent(items[idx]!.imageId)}`);
          }
          break;
        case "k":
        case "K":
          e.preventDefault();
          toggleSketchfab();
          break;
        case "m":
        case "M":
          setMuted(!mutedRef.current);
          break;
        case "Escape":
          // When the Sketchfab panel is open, let it handle dismissal —
          // don't navigate away from the session.
          if (sketchfabOpen) return;
          if (!pathname.startsWith("/report/")) {
            router.push("/");
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext, idx, items, router, pathname, toggleFullscreen, toggleSketchfab, sketchfabOpen, setMuted]);

  // Cursor hide when chrome hidden
  useEffect(() => {
    document.body.style.cursor = chromeVisible ? "default" : "none";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [chromeVisible]);

  const current = items[idx]!;
  const currentName = current.commonName || current.taxonSpecies || current.imageId;

  // Mobile tap-to-pause: distinguish tap from swipe via <10px movement and
  // <250ms duration. Don't fire on touches that started inside the action
  // bar (those buttons handle their own clicks) or the magnifier loupe.
  // Touch-only — desktop clicks never reach these handlers.
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - start.x);
    const dy = Math.abs(t.clientY - start.y);
    const dt = Date.now() - start.t;
    if (dx < 10 && dy < 10 && dt < 250) {
      const target = e.target as HTMLElement;
      if (target.closest(".session-action-bar-panel")) return;
      if (target.closest(".session-magnifier")) return;
      setPaused((p) => !p);
    }
  };

  return (
    <main
      aria-label="drawing session"
      style={{ position: "fixed", inset: 0, background: T.surface0 }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <h1 className="u-sr-only">{currentName}</h1>
      <ProgressBar percent={elapsedMs / durationMs} playing={!paused && !done} />
      <SessionTitle image={current} />
      <Timer remainingMs={durationMs - elapsedMs} paused={paused} muted={muted} />
      <SessionImage image={current} bw={bw} chromeVisible={chromeVisible} />
      {paused && (
        <div className="session-paused-overlay" role="status" aria-live="polite">
          <span className="session-paused-glyph" aria-hidden>⏸</span>
          <span className="session-paused-label">paused</span>
        </div>
      )}
      <SourceInfoChip image={current} visible={chromeVisible} />
      <EdgePrevNext
        visible={chromeVisible}
        canPrev={idx > 0}
        canNext={idx < items.length - 1}
        onPrev={goPrev}
        onNext={goNext}
      />
      <SessionActionBar
        visible={chromeVisible}
        paused={paused}
        bw={bw}
        magnifier={magnifier}
        isFullscreen={isFullscreen}
        currentIdx={idx}
        total={items.length}
        intervalSec={intervalSec}
        sourceImageUrl={current.imageUrl}
        muted={muted}
        onToggleMute={() => setMuted(!muted)}
        onPause={() => setPaused((p) => !p)}
        onToggleBw={() => setBw((v) => !v)}
        onMagnifier={() =>
          setMagnifier((cur) => {
            const i = MAG_CYCLE.indexOf(cur);
            return MAG_CYCLE[(i + 1) % MAG_CYCLE.length]!;
          })
        }
        onToggleFullscreen={toggleFullscreen}
        onReport={() => router.push(`/report/${encodeURIComponent(current.imageId)}`)}
        onIntervalChange={(s) => setIntervalSec(s)}
        sketchfabOpen={sketchfabOpen}
        onToggleSketchfab={toggleSketchfab}
        sketchfabDisabled={sketchfabAvailable === false}
      />
      <Magnifier image={current} size={magnifier} bw={bw} />
      <EndOfSessionOverlay
        visible={done}
        count={items.length}
        onNewSession={() => router.push("/")}
      />
      <SketchfabBrowsePanel
        scientific={current.taxonSpecies ?? ""}
        common={current.commonName ?? ""}
        open={sketchfabOpen}
        onClose={() => setSketchfabOpen(false)}
      />
    </main>
  );
}
