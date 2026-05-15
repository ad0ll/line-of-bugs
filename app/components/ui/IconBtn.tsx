"use client";
import { T } from "@/lib/tokens";

interface IconBtnProps {
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  as?: "button" | "a";
  href?: string;
  target?: string;
  children: React.ReactNode;
}

export function IconBtn({
  label,
  hint,
  active = false,
  disabled = false,
  onClick,
  onContextMenu,
  as = "button",
  href,
  target,
  children,
}: IconBtnProps) {
  const className = `u-icon-btn${active ? " is-active" : ""}`;
  const style: React.CSSProperties = {
    minWidth: 54,
    minHeight: 44,
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: `${T.s2}px ${T.s3}px`,
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  };
  const content = (
    <>
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
        {children}
      </span>
      <span
        style={{
          fontSize: T.textXs,
          letterSpacing: T.trackingWider,
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {hint ? (
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono), monospace",
            opacity: active ? 1 : 0.7,
            lineHeight: 1,
          }}
        >
          {hint}
        </span>
      ) : null}
    </>
  );

  if (as === "a" && href) {
    return (
      <a
        href={href}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
        className={className}
        style={style}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={disabled ? undefined : onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
    >
      {content}
    </button>
  );
}
