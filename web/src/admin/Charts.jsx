import { useLayoutEffect, useRef, useState } from 'react';

export function compact(n) {
  if (n == null || Number.isNaN(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Column chart, single series: 24px max bars with a rounded 4px cap, square at the baseline,
// recessive hairline grid, and a per-bar hover/focus tooltip.
export function Columns({ days, value, format = compact, label, detail }) {
  const box = useRef(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const h = 190;
  const padL = 40;
  const padT = 10;
  const padB = 24;
  const base = h - padB;
  const plotH = base - padT;
  const max = niceMax(Math.max(0, ...days.map(value)));
  const ticks = [0, max / 2, max];
  const band = (w - padL) / Math.max(1, days.length);
  const bw = Math.max(2, Math.min(24, band - 2));
  const y = (v) => base - (v / max) * plotH;
  const labelIdx = days.length > 1 ? [0, Math.floor((days.length - 1) / 2), days.length - 1] : [0];

  const bar = (x, top, width, height) => {
    const r = Math.min(4, height, width / 2);
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
  };

  const hd = hover != null ? days[hover] : null;
  const tipX = hover != null ? Math.min(Math.max(padL + hover * band + band / 2, 70), w - 70) : 0;

  return (
    <div className="chart" ref={box}>
      <svg width={w} height={h} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={w} y1={y(t)} y2={y(t)} />
            <text className="tick" x={padL - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {compact(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = value(d);
          const bh = (v / max) * plotH;
          const x = padL + i * band + (band - bw) / 2;
          return (
            <g key={d.day}>
              {v > 0 && <path className={`bar ${hover === i ? 'hover' : ''}`} d={bar(x, base - bh, bw, bh)} />}
              <rect
                className="hit"
                x={padL + i * band}
                y={padT}
                width={band}
                height={plotH}
                tabIndex={0}
                aria-label={`${dayLabel(d.day)}: ${format(v)}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
        {labelIdx.map((i) => (
          <text key={i} className="tick" x={padL + i * band + band / 2} y={h - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>
            {dayLabel(days[i].day)}
          </text>
        ))}
      </svg>
      {hd && (
        <div className="tip" style={{ left: tipX, top: Math.max(0, y(value(hd)) - 12) }}>
          <strong>{format(value(hd))}</strong>
          <span>{dayLabel(hd.day)}</span>
          {detail?.(hd)}
        </div>
      )}
    </div>
  );
}
