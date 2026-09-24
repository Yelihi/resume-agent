import { CaretLeft, CaretRight } from "@phosphor-icons/react";

type PaginationProps = {
  label: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
};

export function Pagination({ label, page, pageCount, onPageChange }: PaginationProps) {
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);
  return <nav className="pagination" aria-label={label}>
    <button type="button" disabled={page === 1} aria-label="이전 페이지" onClick={() => onPageChange(page - 1)}><CaretLeft aria-hidden="true" size={18} /></button>
    {pages.map(number => <button type="button" key={number} aria-label={`${number}페이지`} aria-current={number === page ? "page" : undefined} onClick={() => onPageChange(number)}>{number}</button>)}
    <button type="button" disabled={page === pageCount} aria-label="다음 페이지" onClick={() => onPageChange(page + 1)}><CaretRight aria-hidden="true" size={18} /></button>
    <span className="pagination-status" role="status">{page} / {pageCount} 페이지</span>
  </nav>;
}
