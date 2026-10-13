import { useState } from 'react';

const W = 340;
const H = 170;
const PAD = { l: 38, r: 10, t: 12, b: 22 };

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    min = min - 1;
    max = max + 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

function shortDate(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function LineChart({ points, format = (v) => String(Math.round(v)) }: { points: { x: number; y: number }[]; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <div className="empty small">No data yet</div>;
  const ys = points.map((p) => p.y);
  const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys));
  const x0 = points[0].x;
  const x1 = points[points.length - 1].x;
  const sx = (x: number) => PAD.l + (x1 === x0 ? (W - PAD.l - PAD.r) / 2 : ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r));
  const sy = (y: number) => PAD.t + (1 - (y - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = `${d}L${sx(x1).toFixed(1)},${H - PAD.b}L${sx(x0).toFixed(1)},${H - PAD.b}Z`;
  const active = hover != null ? points[hover] : points[points.length - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const dd = Math.abs(sx(p.x) - x);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>{format(active.y)}</span>
        <span className="small subtle">{shortDate(active.x)}</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: 'pan-y' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} />
            <text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6}>
          {shortDate(x0)}
        </text>
        {x1 !== x0 && (
          <text x={W - PAD.r} y={H - 6} textAnchor="end">
            {shortDate(x1)}
          </text>
        )}
        <path className="area" d={area} />
        <path className="line" d={d} />
        {points.length <= 40 && points.map((p, i) => <circle key={i} className="dot" cx={sx(p.x)} cy={sy(p.y)} r={2.5} />)}
        {hover != null && (
          <>
            <line className="grid" x1={sx(active.x)} x2={sx(active.x)} y1={PAD.t} y2={H - PAD.b} />
            <circle className="dot" cx={sx(active.x)} cy={sy(active.y)} r={5} />
          </>
        )}
      </svg>
    </div>
  );
}

export function BarChart({ bars, format = (v) => String(Math.round(v)) }: { bars: { label: string; value: number; highlight?: boolean }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const { hi, ticks } = niceTicks(0, max, 3);
  const bw = (W - PAD.l - PAD.r) / bars.length;
  const sy = (y: number) => PAD.t + (1 - y / (hi || 1)) * (H - PAD.t - PAD.b);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} />
          <text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = PAD.l + i * bw + bw * 0.18;
        const h = H - PAD.b - sy(b.value);
        return (
          <g key={i}>
            <rect className={'bar' + (b.highlight === false ? ' muted' : '')} x={x} y={sy(b.value)} width={bw * 0.64} height={Math.max(0, h)} rx={3} />
            {(bars.length <= 8 || i % 2 === bars.length % 2) && (
              <text x={x + bw * 0.32} y={H - 6} textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
