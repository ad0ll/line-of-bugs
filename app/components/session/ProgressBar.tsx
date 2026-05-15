"use client";

interface Props {
  percent: number; // 0..1
  playing: boolean;
}

export function ProgressBar({ percent, playing }: Props) {
  const clamped = Math.max(0, Math.min(1, percent));
  return (
    <div className="session-progress-track">
      <div
        data-testid="progress-fill"
        className="session-progress-fill"
        style={{
          transform: `scaleX(${clamped})`,
          transition: playing ? "transform 0.1s linear" : "",
        }}
      />
    </div>
  );
}
