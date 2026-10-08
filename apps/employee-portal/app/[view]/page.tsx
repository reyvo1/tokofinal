import { notFound } from 'next/navigation';
import { EmployeePortalApp } from '../employee-portal-app';
import { isEmployeePortalView } from '../employee-portal-views';

export default async function EmployeePortalViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;

  if (!isEmployeePortalView(view) || view === 'home') {
    notFound();
  }

  return <EmployeePortalApp initialView={view} />;
}
