"use client";
import { IconBtn } from "@/app/components/ui/IconBtn";
import { TimerDropdown } from "@/app/components/session/TimerDropdown";

export type MagnifierSize = "off" | "S" | "M" | "L" | "XL";

interface Props {
  visible: boolean;
  paused: boolean;
  bw: boolean;
  magnifier: MagnifierSize;
  isFullscreen: boolean;
  currentIdx: number;
  total: number;
  intervalSec: number;
  /** Direct URL to the image file (preferred — the user wanted source
   *  to open the actual image, not the source page). */
  sourceImageUrl: string | null | undefined;
  /** Mute state — surfaced as a toggle button between b.w and magnifier so
   *  the keyboard 'M' shortcut and the action bar stay in sync. */
  muted?: boolean;
  onToggleMute?: () => void;
  onPause: () => void;
  onToggleBw: () => void;
  onMagnifier: () => void;
  onToggleFullscreen: () => void;
  onReport: () => void;
  onIntervalChange: (s: number) => void;
  sketchfabOpen: boolean;
  onToggleSketchfab: () => void;
  sketchfabDisabled?: boolean;
}

// R8 (2026-05-16): zoom cluster removed — browser zoom does the same
// job and the bar is overflowing on mobile. Source button now uses
// the IconBtn-as-link pattern with the same stacked label + (empty)
// hint slot so its height matches every other tile in the bar.
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
        {props.onToggleMute ? (
          <IconBtn
            label={props.muted ? "muted" : "sound"}
            hint="M"
            active={props.muted ?? false}
            onClick={props.onToggleMute}
          >
            {/* Plain unicode (not emoji) keeps the glyph weight aligned
                with neighbours (◐ ⊙ ⛶ ⚑ ▦); emoji rendered ~30px and
                pushed the slot past its 100px min-width. */}
            {props.muted ? "⊘" : "♪"}
          </IconBtn>
        ) : null}
        <IconBtn label="magnifier" hint={props.magnifier === "off" ? "Z" : props.magnifier} active={props.magnifier !== "off"} onClick={props.onMagnifier}>
          ⊙
        </IconBtn>
        <IconBtn label="fullscreen" hint="F" active={props.isFullscreen} onClick={props.onToggleFullscreen}>
          ⛶
        </IconBtn>
        <IconBtn label="report" hint="R" onClick={props.onReport}>
          ⚑
        </IconBtn>
        <IconBtn
          label="sketchfab"
          hint="K"
          active={props.sketchfabOpen}
          disabled={props.sketchfabDisabled ?? false}
          onClick={props.onToggleSketchfab}
        >
          ▦
        </IconBtn>
        {props.sourceImageUrl ? (
          <IconBtn label="go to source" hint=" " as="a" href={props.sourceImageUrl} target="_blank">
            ↗
          </IconBtn>
        ) : null}
        <div className="session-counter">
          <span className="session-counter-current">{(props.currentIdx + 1).toLocaleString()}</span>
          <span className="session-counter-sep">of</span>
          <span className="session-counter-total">{props.total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
