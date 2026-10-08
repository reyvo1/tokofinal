'use client';

type LinePoint = { label: string; primary: number; secondary?: number };
type ShareItem = { label: string; value: number; detail?: string };
type BarPoint = { label: string; value: number };

function compactNumber(value: number) { return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }

export function LineSeriesChart({ data, primaryLabel, secondaryLabel, valueLabel }: { data: LinePoint[]; primaryLabel: string; secondaryLabel?: string; valueLabel: (value: number) => string; }) {
  const width = 720; const height = 250; const padX = 28; const padY = 24;
  const max = Math.max(1, ...data.flatMap((point) => [point.primary, point.secondary ?? 0]));
  const coords = (key: 'primary' | 'secondary') => data.map((point, index) => { const x = padX + index * ((width - padX * 2) / Math.max(1, data.length - 1)); const raw = key === 'primary' ? point.primary : point.secondary ?? 0; const y = height - padY - (raw / max) * (height - padY * 2); return { x, y, raw, label: point.label }; });
  const path = (key: 'primary' | 'secondary') => coords(key).map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const primary = coords('primary'); const secondary = secondaryLabel ? coords('secondary') : [];
  return (
    <figure className="chartFigure" data-chart-kind="line" aria-label={`${primaryLabel}${secondaryLabel ? ` dan ${secondaryLabel}` : ''}`}>
      <svg className="chartCanvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik ${primaryLabel}${secondaryLabel ? ` dan ${secondaryLabel}` : ''}`}>
        {[.25,.5,.75,1].map((step) => <path key={step} className="chartGridLine" d={`M${padX},${height-padY-(height-padY*2)*step} H${width-padX}`} />)}
        <path className="chartLine chartLinePrimary" d={path('primary')} />
        {secondaryLabel && <path className="chartLine chartLineSecondary" d={path('secondary')} />}
        {primary.map((point) => <circle key={`${point.label}-p`} className="chartPoint" cx={point.x} cy={point.y} r="4"><title>{point.label}: {valueLabel(point.raw)}</title></circle>)}
        {secondaryLabel && secondary.map((point) => <circle key={`${point.label}-s`} className="chartPoint chartPointSecondary" cx={point.x} cy={point.y} r="4"><title>{point.label}: {valueLabel(point.raw)}</title></circle>)}
      </svg>
      <figcaption className="chartLegend"><span><i className="chartLegendLine" />{primaryLabel}</span>{secondaryLabel && <span><i className="chartLegendLine secondary" />{secondaryLabel}</span>}{data.length > 1 && <small>{data[0]?.label} — {data[data.length - 1]?.label}</small>}</figcaption>
    </figure>
  );
}

export function ShareBars({ items, valueLabel }: { items: ShareItem[]; valueLabel: (value: number) => string }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0));
  return <figure className="chartFigure" data-chart-kind="share-bars" aria-label="Distribusi channel"><div className="shareChart" role="img" aria-label="Distribusi penjualan per channel">{items.map((item) => { const pct = Math.round((item.value / total) * 100); return <div className="shareRow" key={item.label}><div className="shareLabel"><strong>{item.label}</strong><span>{pct}% · {valueLabel(item.value)}</span></div><div className="shareTrack" aria-hidden="true"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>{item.detail && <small className="mt-1 block text-[9px] text-slate-400">{item.detail}</small>}</div>; })}</div><figcaption className="chartCaption">Total {valueLabel(total)}</figcaption></figure>;
}

export function BarSeriesChart({ data, totalLabel }: { data: BarPoint[]; totalLabel?: string }) {
  const max = Math.max(1, ...data.map((point) => point.value));
  return <figure className="chartFigure" data-chart-kind="bars" aria-label={totalLabel ?? 'Grafik batang'}><div className="barChart" role="img" aria-label={totalLabel ?? 'Grafik batang'}>{data.map((point) => <div className="barColumn" key={point.label}><span className="barValue">{compactNumber(point.value)}</span><span className="barTrack"><i style={{ height: `${Math.max(3, (point.value / max) * 100)}%` }}><span className="srOnly">{point.label}: {point.value}</span></i></span><small>{point.label}</small></div>)}</div>{totalLabel && <figcaption className="chartCaption">{totalLabel}</figcaption>}</figure>;
}
