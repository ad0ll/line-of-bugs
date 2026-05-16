export default function Loading() {
  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <h1>gallery</h1>
        <div className="search-skeleton" />
        <div className="gallery-filters-skeleton" aria-hidden>
          <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--wide" />
          <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--mid" />
          <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--wide" />
          <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--narrow" />
        </div>
      </header>
      <div className="gallery-grid skeleton">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="grid-item skeleton-tile" />
        ))}
      </div>
    </main>
  );
}
