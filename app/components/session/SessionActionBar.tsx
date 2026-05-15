"use client";
import { IconBtn } from "@/app/components/ui/IconBtn";
import { TimerDropdown } from "@/app/components/session/TimerDropdown";

export type MagnifierSize = "off" | "S" | "M" | "L" | "XL";

interface Props {
  visible: boolean;
  paused: boolean;
  bw: boolean;
  magnifier: MagnifierSize;
  zoom: number;
  isFullscreen: boolean;
  currentIdx: number;
  total: number;
  intervalSec: number;
  sourceUrl: string;
  onPause: () => void;
  onToggleBw: () => void;
  onMagnifier: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onToggleFullscreen: () => void;
  onReport: () => void;
  onIntervalChange: (s: number) => void;
}

export function SessionActionBar(props: Props) {
  return (
    <div
      className="session-action-bar-wrap"
      style={{
        opacity: props.visible ? 1 : 0,
        transform: `translateY(${props.visible ? 0 : 12}px)`,
        pointerEvents: props.visible ? "auto" : "none",
      }}
    >
      <div className="session-action-bar-panel u-backdrop-blur-md">
        <IconBtn label={props.paused ? "play" : "pause"} hint="space" active={props.paused} onClick={props.onPause}>
          {props.paused ? "▶" : "⏸"}
        </IconBtn>
        <TimerDropdown current={props.intervalSec} onChange={props.onIntervalChange} />
        <IconBtn label="b.w" hint="B" active={props.bw} onClick={props.onToggleBw}>
          ◐
        </IconBtn>
        <IconBtn label="magnifier" hint={props.magnifier === "off" ? "Z" : props.magnifier} active={props.magnifier !== "off"} onClick={props.onMagnifier}>
          ⊙
        </IconBtn>

        {/* Zoom cluster: −  ⤢ (reset, shows current zoom)  + */}
        <div className="session-zoom-cluster">
          <button
            type="button"
            aria-label="zoom out"
            onClick={props.onZoomOut}
            disabled={props.zoom <= 0.25}
            className="u-icon-btn session-zoom-btn"
          >
            −
          </button>
          <button
            type="button"
            aria-label="reset zoom"
            onClick={props.onResetZoom}
            className={`u-icon-btn session-zoom-btn session-zoom-btn-reset${props.zoom !== 1 ? " is-active" : ""}`}
            title="reset zoom (0)"
          >
            {props.zoom === 1 ? "1.00×" : `${props.zoom.toFixed(2)}×`}
          </button>
          <button
            type="button"
            aria-label="zoom in"
            onClick={props.onZoomIn}
            disabled={props.zoom >= 4}
            className="u-icon-btn session-zoom-btn"
          >
            +
          </button>
        </div>

        <IconBtn label="fullscreen" hint="F" active={props.isFullscreen} onClick={props.onToggleFullscreen}>
          {props.isFullscreen ? "⛶" : "⛶"}
        </IconBtn>
        <IconBtn label="report" hint="R" onClick={props.onReport}>
          ⚑
        </IconBtn>
        <IconBtn label="source" as="a" href={props.sourceUrl} target="_blank">
          ↗
        </IconBtn>
        <div className="session-counter">
          {props.currentIdx + 1} / {props.total}
        </div>
      </div>
    </div>
  );
}
