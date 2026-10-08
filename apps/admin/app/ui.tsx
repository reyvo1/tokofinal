'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, Plus } from 'lucide-react';

export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const duration = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return <>{format ? format(display) : Math.round(display).toLocaleString('id-ID')}</>;
}

export function Panel({ eyebrow, title, badge, children }: { eyebrow: string; title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="panel panelHover">
      <div className="panelTitle">
        <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
        {badge && <span>{badge}</span>}
      </div>
      {children}
    </section>
  );
}

export function Skeleton({ rows = 4, style }: { rows?: number; style?: CSSProperties }) {
  return (
    <div className="skeletonStack" style={style} aria-busy="true" aria-label="Memuat data">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`skeletonRow ${i % 3 === 0 ? 'wide' : i % 3 === 1 ? 'mid' : 'short'}`} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="tr tableSkeletonColumns" key={i}>
          <div className="skeletonBar skeletonBarWide" />
          <div className="skeletonBar skeletonBarMid" />
          <div className="skeletonBar skeletonBarShort" />
        </div>
      ))}
    </div>
  );
}

export function SpinnerLine({ text }: { text?: string }) {
  return <div className="spinnerLine"><Loader2 size={16} className="spinIcon" /> {text ?? 'Memuat...'}</div>;
}

export function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="emptyState fadeSlideIn">
      <div>
        <div className="emptyIcon"><Inbox size={22} strokeWidth={1.6} /></div>
        <h4>{title}</h4>
        <p>{description}</p>
        {actionLabel && onAction && <button type="button" className="emptyCta primaryButton" onClick={onAction}><Plus size={14} /> {actionLabel}</button>}
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="emptyState errorState fadeSlideIn">
      <div>
        <div className="emptyIcon err"><AlertTriangle size={22} strokeWidth={1.6} /></div>
        <h4>Terjadi kendala</h4>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function Table({ head, rows, empty, title, loading }: { head: string[]; rows: ReactNode[][]; empty?: string; title?: string; loading?: boolean }) {
  if (loading) return <TableSkeleton rows={5} />;
  if (!rows.length) return <EmptyState title={empty ?? 'Belum ada data.'} description={title ? `Data untuk "${title}" akan muncul di sini begitu tersedia.` : 'Tambahkan data baru untuk mulai menggunakan bagian ini.'} />;

  const columns = `repeat(${head.length}, minmax(0, 1fr))`;
  return (
    <div className="table">
      <div className="tr th" style={{ gridTemplateColumns: columns }}>{head.map((h) => <span key={h}>{h}</span>)}</div>
      {rows.map((row, i) => (
        <div className="tr rowFade" key={i} style={{ gridTemplateColumns: columns, animationDelay: `${Math.min(i * 40, 320)}ms` }}>
          {row.map((cell, j) => <span key={j}>{cell}</span>)}
        </div>
      ))}
    </div>
  );
}

const STATUS_MAP: Record<string, { tone: 'ok' | 'warn' | 'err' | 'info'; label?: string }> = {
  AKTIF: { tone: 'ok' }, ACTIVE: { tone: 'ok' }, ON: { tone: 'ok' }, SENT: { tone: 'ok' }, COMPLETED: { tone: 'ok' }, APPROVED: { tone: 'ok' }, PAID: { tone: 'ok' },
  NONAKTIF: { tone: 'warn' }, INACTIVE: { tone: 'warn' }, OFF: { tone: 'warn' }, PENDING: { tone: 'warn' }, DRAFT: { tone: 'warn' }, PROCESSING: { tone: 'warn' },
  CANCELLED: { tone: 'err' }, REJECTED: { tone: 'err' }, FAILED: { tone: 'err' }, CORE: { tone: 'info' },
};

export function StatusChip({ status }: { status: string }) {
  const meta = STATUS_MAP[status.toUpperCase()] ?? { tone: 'info' as const };
  return <span className={`statusChip ${meta.tone}`}><span className="statusDot" />{meta.label ?? status}</span>;
}

export function rupiah(v: number | string) {
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2)} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)} jt`;
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

export function tanggal(v: string | Date) {
  return new Date(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
