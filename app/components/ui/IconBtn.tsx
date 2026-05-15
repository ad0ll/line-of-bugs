"use client";

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
  const className = `u-icon-btn u-icon-btn-stacked${active ? " is-active" : ""}`;
  // `title` surfaces the shortcut on desktop hover (visible labels stay terse);
  // `aria-label` is also the only accessible name on narrow viewports, where
  // .u-icon-btn-stacked-label / -hint are display:none.
  const a11yLabel = hint ? `${label} (${hint})` : label;
  const content = (
    <>
      <span aria-hidden className="u-icon-btn-stacked-glyph">
        {children}
      </span>
      <span className="u-icon-btn-stacked-label">{label}</span>
      {hint ? <span className="u-icon-btn-stacked-hint">{hint}</span> : null}
    </>
  );

  if (as === "a" && href) {
    return (
      <a
        href={href}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
        className={className}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={a11yLabel}
        aria-label={a11yLabel}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={disabled ? undefined : onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
      title={a11yLabel}
      aria-label={a11yLabel}
    >
      {content}
    </button>
  );
}
