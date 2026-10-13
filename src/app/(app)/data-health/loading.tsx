/*
 * IMPORTANT - do not add a loading.tsx to a page that has a FilterBar.
 *
 * In Next.js 15.5, a route with a loading.tsx never commits a navigation to
 * the SAME route with different search params: the RSC request is sent and
 * returns 200, but the router drops it and the URL never changes. Every
 * filter on that page then silently does nothing. Verified by A/B: with the
 * file removed the period and division filters apply 3/3; with it present,
 * 0/3 - including with a trivial `<div>Loading…</div>` fallback, so it is the
 * boundary itself and not the skeleton.
 *
 * This page has no filters, so the boundary is safe here and gives an instant
 * skeleton on arrival. Filtered pages rely on the per-link spinner in the
 * sidebar for that feedback instead.
 */
import { TablePageSkeleton } from '@/components/layout/page-skeleton'

export default function Loading() {
  return <TablePageSkeleton filters={0} />
}