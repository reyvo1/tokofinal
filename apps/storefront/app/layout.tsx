import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Toko360 Official Store', description: 'Katalog dan checkout pelanggan Toko360.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-t360-theme="light" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
