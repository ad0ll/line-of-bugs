"use client";
import { useState } from 'react';
import type { GalleryRow } from '@/lib/queries/gallery';
import { isOrderOnlyId, titleCaseCommonName } from '@/lib/text-format';
import { TileActions } from '@/app/components/gallery/TileActions';
import { OrderBadge } from '@/app/components/ui/OrderBadge';
import { BugNotFoundThumb } from '@/app/components/gallery/BugNotFoundThumb';
import { TileMetaChips } from '@/app/components/gallery/TileMetaChips';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function sourceName(source: string): string {
  if (source === 'inaturalist') return 'iNaturalist';
  if (source === 'bugwood') return 'Bugwood';
  return source;
}

export function GridTile({ row }: { row: GalleryRow }) {
  // Plain <img> instead of next/image so we can swap to the placeholder on
  // load failure without next/image's own error handling kicking in.
  // Trade-off: lose responsive srcset, but thumbs are already 512px and our
  // breakpoints serve a single tier, so the loss is negligible.
  const [thumbBroken, setThumbBroken] = useState(false);
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
        {thumbBroken ? (
          <BugNotFoundThumb />
        ) : (
          <img
            src={`/api/thumb/${thumbName}`}
            alt={commonName || row.taxon_species || (row.taxon_order ? `${row.taxon_order} specimen` : 'specimen')}
            loading="lazy"
            decoding="async"
            onError={() => setThumbBroken(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
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
        <div className="grid-item-meta-row">
          {row.taxon_order && !orderOnly && <OrderBadge order={row.taxon_order} />}
          {row.license && (
            <span className="grid-item-license" aria-label={`license ${row.license}`}>
              {row.license}
            </span>
          )}
        </div>
        <TileMetaChips
          lifeStage={row.life_stage}
          sex={row.sex}
          institution={row.institution}
        />
      </div>
    </article>
  );
}
