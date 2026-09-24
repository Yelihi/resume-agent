import { useState } from "react";

export function usePagination<Item>(items: readonly Item[]) {
  const pageSize = 12;
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  if (requestedPage !== page) setPage(page);
  return {
    page, pageCount,
    items: items.slice((page - 1) * pageSize, page * pageSize),
    setPage: (next: number) => setPage(Math.max(1, Math.min(next, pageCount))),
  };
}
