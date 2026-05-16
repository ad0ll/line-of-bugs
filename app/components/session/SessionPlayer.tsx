"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { Image } from "@/db/schema";
import { useHighResTimer } from "@/lib/hooks/useHighResTimer";
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [done, setDone] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const zoomIn = useCallback(() => setZoom((z) => Math.min(4, z + 0.25)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.25, z - 0.25)), []);

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
    audioRef.current = makeAudio();
    preloadRef.current = createPreloadManager((id) => {
      const item = items.find((it) => it.imageId === id);
      return item ? `/api/img/${item.filename.replace(/^images\//, "")}` : "";
    });
    preloadRef.current.setQueue(items.map((it) => it.imageId));
  }, [items]);

  // On slide change: reset per-slide state + preload next + mark current used
  useEffect(() => {
    setElapsedMs(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
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
    !paused && !done && !reportModalOpen,
    onTick,
    advance,
    `${idx}-${intervalSec}`,
  );

  // Chrome auto-hide (mousemove → reset 2s timer). Force-show while modal open.
  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    if (reportModalOpen) return;
    chromeTimerRef.current = setTimeout(() => setChromeVisible(false), T.durationChromeHide);
  }, [reportModalOpen]);

  useEffect(() => {
    if (reportModalOpen) {
      setChromeVisible(true);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    }
  }, [reportModalOpen]);

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
        case "+":
        case "=":
          setZoom((z) => Math.min(4, z + 0.25));
          break;
        case "-":
        case "_":
          setZoom((z) => Math.max(0.25, z - 0.25));
          break;
        case "0":
          setZoom(1);
          setPan({ x: 0, y: 0 });
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
        case "Escape":
          if (!pathname.startsWith("/report/")) {
            router.push("/");
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext, idx, items, router, pathname, toggleFullscreen]);

  // Cursor hide when chrome hidden
  useEffect(() => {
    document.body.style.cursor = chromeVisible ? "default" : "none";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [chromeVisible]);

  // Drag-pan when zoomed
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || zoom <= 1) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };

  const current = items[idx]!;
  const currentName = current.commonName || current.taxonSpecies || current.imageId;

  return (
    <main
      aria-label="drawing session"
      style={{ position: "fixed", inset: 0, background: T.surface0 }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <h1 className="u-sr-only">{currentName}</h1>
      <ProgressBar percent={elapsedMs / durationMs} playing={!paused && !done} />
      <SessionTitle image={current} />
      <Timer remainingMs={durationMs - elapsedMs} paused={paused} />
      <SessionImage image={current} bw={bw} zoom={zoom} pan={pan} />
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
        zoom={zoom}
        isFullscreen={isFullscreen}
        currentIdx={idx}
        total={items.length}
        intervalSec={intervalSec}
        sourceUrl={current.sourcePageUrl}
        onPause={() => setPaused((p) => !p)}
        onToggleBw={() => setBw((v) => !v)}
        onMagnifier={() =>
          setMagnifier((cur) => {
            const i = MAG_CYCLE.indexOf(cur);
            return MAG_CYCLE[(i + 1) % MAG_CYCLE.length]!;
          })
        }
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={() => {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
        onToggleFullscreen={toggleFullscreen}
        onReport={() => router.push(`/report/${encodeURIComponent(current.imageId)}`)}
        onIntervalChange={(s) => setIntervalSec(s)}
      />
      <Magnifier image={current} size={magnifier} bw={bw} />
      <EndOfSessionOverlay
        visible={done}
        count={items.length}
        onNewSession={() => router.push("/")}
      />
    </main>
  );
}
