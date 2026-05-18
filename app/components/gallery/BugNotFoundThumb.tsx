import { WiltedFlower } from "@/app/components/icons";

/**
 * Placeholder rendered when a tile's thumbnail file is missing on disk
 * (DB row references a file that doesn't exist — currently 9 of ~40k rows
 * from incremental fetcher desync). Renders inside `.grid-item-image` so
 * the tile silhouette stays intact instead of collapsing.
 */
export function BugNotFoundThumb() {
  return (
    <div className="bug-not-found-thumb" aria-label="bug not found">
      <WiltedFlower size={48} />
      <span>bug not found</span>
    </div>
  );
}
