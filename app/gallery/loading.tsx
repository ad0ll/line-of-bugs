export default function Loading() {
  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <h1>gallery</h1>
        <div className="search-skeleton" />
        <div className="gallery-filters-skeleton" />
      </header>
      <div className="gallery-grid skeleton">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="grid-item skeleton-tile" />
        ))}
      </div>
    </main>
  );
}
