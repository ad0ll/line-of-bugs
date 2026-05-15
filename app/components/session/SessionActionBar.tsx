"use client";
import { T } from "@/lib/tokens";
import { IconBtn } from "@/app/components/ui/IconBtn";
import { TimerDropdown } from "@/app/components/session/TimerDropdown";

export type MagnifierSize = "off" | "S" | "M" | "L" | "XL";

interface Props {
  visible: boolean;
  paused: boolean;
  bw: boolean;
  magnifier: MagnifierSize;
  zoom: number;
  currentIdx: number;
  total: number;
  intervalSec: number;
  sourceUrl: string;
  onPause: () => void;
  onToggleBw: () => void;
  onMagnifier: () => void;
  onResetZoom: () => void;
  onReport: () => void;
  onIntervalChange: (s: number) => void;
}

export function SessionActionBar(props: Props) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        padding: `0 ${T.s10}px ${T.s8 + 2}px`,
        opacity: props.visible ? 1 : 0,
        transform: `translateY(${props.visible ? 0 : 12}px)`,
        transition: `opacity ${T.timingSlow}, transform ${T.timingSlow}`,
        pointerEvents: props.visible ? "auto" : "none",
        zIndex: 30,
      }}
    >
      <div
        className="u-backdrop-blur-md"
        style={{
          display: "flex",
          alignItems: "center",
          gap: T.s2,
          background: T.surfaceRaised,
          border: `1px solid ${T.borderFaint}`,
          borderRadius: T.r4xl,
          padding: T.s3,
          boxShadow: T.shadowPanel,
        }}
      >
        <IconBtn label={props.paused ? "play" : "pause"} hint="space" active={props.paused} onClick={props.onPause}>
          {props.paused ? "▶" : "⏸"}
        </IconBtn>
        <TimerDropdown current={props.intervalSec} onChange={props.onIntervalChange} />
        <IconBtn label="b.w" hint="B" active={props.bw} onClick={props.onToggleBw}>
          ◐
        </IconBtn>
        <IconBtn label="magnifier" hint={props.magnifier === "off" ? "Z" : props.magnifier} active={props.magnifier !== "off"} onClick={props.onMagnifier}>
          🔍
        </IconBtn>
        <IconBtn label="zoom" hint={props.zoom === 1 ? "0" : props.zoom.toFixed(2)} active={props.zoom !== 1} onClick={props.onResetZoom}>
          ⤢
        </IconBtn>
        <IconBtn label="report" hint="R" onClick={props.onReport}>
          📣
        </IconBtn>
        <IconBtn label="source" as="a" href={props.sourceUrl} target="_blank">
          🔗
        </IconBtn>
        <div
          style={{
            padding: `${T.s2}px ${T.s4}px`,
            fontFamily: "var(--font-mono), monospace",
            fontSize: T.textXs,
            color: T.textTertiary,
            minWidth: 56,
            textAlign: "center",
          }}
        >
          {props.currentIdx + 1} / {props.total}
        </div>
      </div>
    </div>
  );
}
