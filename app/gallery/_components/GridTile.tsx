import Image from 'next/image';
import type { GalleryRow } from '@/lib/queries/gallery';
import { isOrderOnlyId, titleCaseCommonName } from '@/lib/text-format';
import { TileActions } from '@/app/components/gallery/TileActions';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function sourceName(source: string): string {
  if (source === 'inaturalist') return 'iNaturalist';
  if (source === 'bugwood') return 'Bugwood';
  return source;
}

export function GridTile({ row }: { row: GalleryRow }) {
  const thumbName = basename(row.thumbnail_filename);
  const mediumName = basename(row.medium_filename);
  const commonName = titleCaseCommonName(row.common_name);
  const orderOnly = isOrderOnlyId(row.common_name, row.taxon_species, row.taxon_order);
  return (
    <article
      className="grid-item"
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
        <TileActions
          viewFullHref={`/api/medium/${mediumName}`}
          sourceHref={row.image_url}
          sourceName={sourceName(row.source)}
        />
        {row.license && (
          <span className="grid-item-license" aria-label={`license ${row.license}`}>
            {row.license}
          </span>
        )}
      </div>
      <div className="grid-item-meta">
        {commonName && (
          <span className="grid-item-name">
            {commonName}
            {orderOnly && <span className="grid-item-order-hint"> (order)</span>}
          </span>
        )}
        {row.taxon_species && !orderOnly && (
          <span className="grid-item-species">{row.taxon_species}</span>
        )}
      </div>
    </article>
  );
}
