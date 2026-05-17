interface TileActionsProps {
  /** Our cached image route — viewable in-browser. */
  viewFullHref: string;
  /** External source URL (bugwoodcloud.org / iNat detail page). */
  sourceHref: string;
  /** Source name for the second chip's accessible label (e.g. "Bugwood"). */
  sourceName: string;
}

export function TileActions({ viewFullHref, sourceHref, sourceName }: TileActionsProps) {
  return (
    <div className="tile-actions" aria-label="tile actions">
      <a
        href={viewFullHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="view full"
        className="tile-action"
      >
        view full
      </a>
      <a
        href={sourceHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`go to ${sourceName}`}
        className="tile-action"
      >
        {sourceName} <span aria-hidden>↗</span>
      </a>
    </div>
  );
}
