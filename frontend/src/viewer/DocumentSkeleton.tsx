export function DocumentSkeleton() {
  return (
    <div className="pdf-viewer" role="status" aria-label="문서 미리보기를 준비하고 있습니다">
      <div className="page-shell document-skeleton" aria-hidden="true">
        <div className="document-skeleton-heading"><span className="skeleton-line is-short" /><span className="skeleton-line is-medium" /></div>
        {[0, 1, 2].map(section => (
          <div className="document-skeleton-section" key={section}>
            <span className="skeleton-line is-short" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line is-medium" />
          </div>
        ))}
      </div>
    </div>
  );
}
