import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Dashboard Admin Toko360', description: 'Pusat operasional, keuangan, SDM, aset, dan kontrol platform Toko360.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-t360-theme="light" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
