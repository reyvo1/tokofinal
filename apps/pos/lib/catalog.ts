/**
 * Catalog loading for the POS screen.
 *
 * Why this exists: `page.tsx` called `/products?limit=100` once and never read
 * `pageInfo.nextCursor`, so every product past the hundredth was invisible to the cashier. A
 * hundred SKUs is a small convenience store, not a supermarket, and the failure is silent — the
 * product simply is not there, with no error anywhere. The `pageInfo` type was declared and never
 * used, so no typecheck and no audit could see it.
 *
 * The fix has two halves, because "load everything" is not a plan when a branch carries tens of
 * thousands of SKUs:
 *
 *   - the browsable grid walks the cursor, so the first screen is fast and the rest is reachable;
 *   - typing in the search box asks the SERVER, because a client-side filter can only ever search
 *     what the client already holds. That is the same bug wearing a different hat: a barcode or a
 *     name that lives on page 7 must still be findable while online.
 *
 * Offline, search degrades to whatever the last snapshot holds, and says so rather than pretending
 * the catalog is complete.
 */

export type CursorPage<T> = {
  items: T[];
  pageInfo: { limit: number; nextCursor: string | null; hasMore: boolean };
};

export type CatalogLoad<T> = {
  products: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Pages actually fetched, so a caller can tell a complete catalog from a truncated one. */
  pagesFetched: number;
};

export const CATALOG_PAGE_SIZE = 100;

/** How many pages the initial silent walk will pull before it stops and reports truncation. */
export const CATALOG_MAX_PAGES = 8;

// The fetch function is generic in the page, so the adapter has to be generic too. Taking a
// pre-cast `(path) => Promise<CursorPage<Product>>` does not typecheck: `CursorPage<Product>` is
// not assignable to an arbitrary `T`.
export type FetchPage = <T>(path: string, activeToken?: string) => Promise<T>;

/**
 * Adapt the POS's generic `api()` to the plain signature this module needs.
 *
 * `api` is declared as `api<T>(path, init?, activeToken?)`; the cursor walkers have no init
 * argument, so this wrapper exists purely to line the two signatures up. It lives here, at the
 * boundary, rather than as a cast at each call site in page.tsx.
 */
export function asCatalogFetcher(api: <R>(path: string, init?: RequestInit, activeToken?: string) => Promise<R>) {
  return <T,>(path: string, activeToken?: string): Promise<T> => api<T>(path, undefined, activeToken);
}

/**
 * Walk the cursor until the catalog is exhausted or the page budget runs out.
 *
 * Stops on the first page that fails rather than continuing with a hole: a partially walked catalog
 * that looks complete is worse than an obvious error, because the cashier has no way to know which
 * products are missing.
 */
export async function loadCatalog<T>(
  fetcher: FetchPage,
  activeToken: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<CatalogLoad<T>> {
  const pageSize = options.pageSize ?? CATALOG_PAGE_SIZE;
  const maxPages = options.maxPages ?? CATALOG_MAX_PAGES;
  const products: T[] = [];
  let cursor: string | null = null;
  let hasMore = false;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) query.set('cursor', cursor);
    const data: CursorPage<T> = await fetcher(`/products?${query.toString()}`, activeToken);
    pagesFetched += 1;
    if (Array.isArray(data?.items)) products.push(...data.items);
    hasMore = Boolean(data?.pageInfo?.hasMore);
    cursor = data?.pageInfo?.nextCursor ?? null;
    // hasMore true with no cursor is a server that cannot paginate further; stop instead of looping.
    if (!hasMore || !cursor) break;
  }

  return { products, nextCursor: hasMore ? cursor : null, hasMore, pagesFetched };
}

/** One more page, for the "muat lagi" control. Returns the new products and the updated cursor. */
export async function loadCatalogPage<T>(
  fetcher: FetchPage,
  activeToken: string,
  cursor: string | null,
  pageSize = CATALOG_PAGE_SIZE,
): Promise<{ products: T[]; nextCursor: string | null; hasMore: boolean }> {
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (cursor) query.set('cursor', cursor);
  const data: CursorPage<T> = await fetcher(`/products?${query.toString()}`, activeToken);
  return {
    products: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.pageInfo?.hasMore ? data.pageInfo.nextCursor ?? null : null,
    hasMore: Boolean(data?.pageInfo?.hasMore),
  };
}

/**
 * Server-side search. Used while online so a term matches products the POS has not loaded.
 *
 * A single space or a term shorter than two characters returns nothing on purpose: the server
 * would return the whole catalog, and the cashier gets their grid back with extra latency. The
 * caller keeps showing the loaded catalog in that case, which is the correct local behaviour.
 */
export async function searchCatalog<T>(
  fetcher: FetchPage,
  activeToken: string,
  term: string,
  pageSize = CATALOG_PAGE_SIZE,
): Promise<T[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const query = new URLSearchParams({ search: trimmed, limit: String(pageSize) });
  const data: CursorPage<T> = await fetcher(`/products?${query.toString()}`, activeToken);
  return Array.isArray(data?.items) ? data.items : [];
}
