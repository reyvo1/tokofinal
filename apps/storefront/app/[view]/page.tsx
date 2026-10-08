import { notFound } from 'next/navigation';
import { StorefrontApp } from '../page';
import type { StorefrontView } from '../storefront-shell';

const VIEWS = new Set<StorefrontView>(['home', 'catalog', 'product', 'cart', 'account']);

export default async function StorefrontViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!VIEWS.has(view as StorefrontView)) notFound();
  return <StorefrontApp initialView={view as StorefrontView} />;
}
