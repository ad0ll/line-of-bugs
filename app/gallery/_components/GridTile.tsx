import Image from 'next/image';
import type { GalleryRow } from '@/lib/queries/gallery';
import { isOrderOnlyId, titleCaseCommonName } from '@/lib/text-format';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

export function GridTile({ row }: { row: GalleryRow }) {
  const thumbName = basename(row.thumbnail_filename);
  const commonName = titleCaseCommonName(row.common_name);
  // Order-only iNat IDs (taxon_species == taxon_order) collapse to one
  // display + "(order)" hint; the taxon-group chip is dropped from every
  // tile because it duplicates filter-state info already exposed by the
  // species chip wall and the URL params. See spec §gallery tile grid.
  const orderOnly = isOrderOnlyId(row.common_name, row.taxon_species, row.taxon_order);
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
        {/* Hierarchy: bold title-cased common name on top, italic scientific
            name below (Linnaean — DON'T title-case). Skip the scientific
            when it would duplicate the common (order-only iNat IDs) and
            instead drop an "(order)" hint inline. */}
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
    </a>
  );
}
