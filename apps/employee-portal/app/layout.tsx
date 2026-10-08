import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Portal Karyawan Toko360', description: 'Absensi dan slip gaji karyawan Toko360.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-t360-theme="light" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
