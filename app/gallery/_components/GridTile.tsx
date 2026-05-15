import type { GalleryRow } from '@/lib/queries/gallery';
import { OrderBadge } from '@/app/components/ui/OrderBadge';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

export function GridTile({ row }: { row: GalleryRow }) {
  const thumbName = basename(row.thumbnail_filename);
  return (
    <a
      className="grid-item"
      href={row.image_url}
      target="_blank"
      rel="noopener noreferrer"
      data-id={row.image_id}
      data-image-path={row.medium_filename}
    >
      <div className="grid-item-image">
        <img
          src={`/api/thumb/${thumbName}`}
          alt=""
          loading="lazy"
        />
        {row.collection_size > 1 && (
          <span className="grid-item-badge">
            {row.collection_index} / {row.collection_size}
          </span>
        )}
      </div>
      <div className="grid-item-meta">
        {row.common_name && <span className="grid-item-name">{row.common_name}</span>}
        {row.taxon_species && <span className="grid-item-species">{row.taxon_species}</span>}
        <OrderBadge order={row.taxon_order} />
      </div>
    </a>
  );
}
