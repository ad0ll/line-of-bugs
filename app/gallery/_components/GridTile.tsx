import Image from 'next/image';
import type { GalleryRow } from '@/lib/queries/gallery';
import { OrderBadge } from '@/app/components/ui/OrderBadge';
import { titleCaseCommonName } from '@/lib/text-format';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

export function GridTile({ row }: { row: GalleryRow }) {
  const thumbName = basename(row.thumbnail_filename);
  const commonName = titleCaseCommonName(row.common_name);
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
        <Image
          src={`/api/thumb/${thumbName}`}
          alt={commonName || row.taxon_species || (row.taxon_order ? `${row.taxon_order} specimen` : 'specimen')}
          fill
          sizes="(min-width: 1024px) 240px, (min-width: 600px) 200px, 50vw"
          style={{ objectFit: 'cover' }}
        />
        {row.collection_size > 1 && (
          <span className="grid-item-badge">
            {row.collection_index} / {row.collection_size}
          </span>
        )}
      </div>
      <div className="grid-item-meta">
        {/* Hierarchy: bold title-cased common name, italic scientific name
            below (Linnaean — DON'T title-case), order badge on a third row. */}
        {commonName && <span className="grid-item-name">{commonName}</span>}
        {row.taxon_species && <span className="grid-item-species">{row.taxon_species}</span>}
        <OrderBadge order={row.taxon_order} />
      </div>
    </a>
  );
}
