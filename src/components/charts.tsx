import { formatRand } from "@/lib/money";

/** Daily net sales as bars with a dashed average line (values in cents). Accessible table fallback included. */
export function SalesBars({ data, highlight }: { data: { date: string; net: number }[]; highlight: string }) {
  const W = 640, H = 220, padL = 8, padR = 8, padT = 16, padB = 28;
  const max = Math.max(1, ...data.map((d) => d.net));
  const avg = data.reduce((s, d) => s + d.net, 0) / Math.max(1, data.length);
  const bw = (W - padL - padR) / data.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - Math.max(0, v) / max);
  const label = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Net sales for the last ${data.length} days. Average ${formatRand(Math.round(avg))} per day.`}>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} stroke="#E5E7EB" strokeWidth="1" />)}
        {data.map((d, i) => {
          const x = padL + i * bw + bw * 0.18, w = bw * 0.64, top = y(d.net), isT = d.date === highlight;
          return (
            <g key={d.date}>
              <rect x={x} y={top} width={w} height={Math.max(0, H - padB - top)} rx="6" fill={isT ? "#365314" : d.net > avg ? "#A3E635" : "#D9F99D"}>
                <title>{`${label(d.date)}: ${formatRand(d.net)}`}</title>
              </rect>
              {(i % 2 === data.length % 2 || isT) && <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#647067">{isT ? "Today" : label(d.date)}</text>}
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke="#8A5A00" strokeWidth="1.5" strokeDasharray="6 5" />
        <text x={padL + 2} y={y(avg) - 6} textAnchor="start" fontSize="11" fill="#8A5A00">Daily average {formatRand(Math.round(avg))}</text>
      </svg>
      <figcaption className="sr-only">
        <table><tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td><td>{formatRand(d.net)}</td></tr>)}</tbody></table>
      </figcaption>
    </figure>
  );
}

/** Two-part ring (e.g. cash vs card share). */
export function SplitRing({ a, b, aLabel, bLabel }: { a: number; b: number; aLabel: string; bLabel: string }) {
  const total = Math.max(0, a) + Math.max(0, b);
  const share = total ? Math.max(0, a) / total : 0;
  const r = 42, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label={`${aLabel} ${Math.round(share * 100)}%, ${bLabel} ${100 - Math.round(share * 100)}%`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#ECFCCB" strokeWidth="14" />
        {total > 0 && <circle cx="50" cy="50" r={r} fill="none" stroke="#365314" strokeWidth="14" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 50 50)" strokeLinecap="butt" />}
        <text x="50" y="55" textAnchor="middle" fontSize="16" fontWeight="600" fill="#17211B">{total ? `${Math.round(share * 100)}%` : "—"}</text>
      </svg>
      <dl className="text-sm">
        <div className="flex items-center gap-2"><span className="size-3 rounded-sm bg-deep" aria-hidden /><dt>{aLabel}</dt><dd className="tabular ml-2 font-semibold">{formatRand(a)}</dd></div>
        <div className="mt-1 flex items-center gap-2"><span className="size-3 rounded-sm bg-soft ring-1 ring-deep/20" aria-hidden /><dt>{bLabel}</dt><dd className="tabular ml-2 font-semibold">{formatRand(b)}</dd></div>
      </dl>
    </div>
  );
}
