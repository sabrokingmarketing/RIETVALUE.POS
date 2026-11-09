import { LOGO_PARTS } from "@/lib/brand-logo";

/** The nursery's emblem, or the uploaded logo when one is set in Settings → Invoices. */
export function LogoMark({ logoFile, className = "size-16", alt = "" }: { logoFile?: string; className?: string; alt?: string }) {
  if (logoFile) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/media/${logoFile}`} alt={alt} className={`${className} object-contain`} />;
  }
  return (
    <svg viewBox="0 0 100 100" className={className} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      {LOGO_PARTS.map((p, i) => <path key={i} d={p.d} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.width} strokeLinecap="round" />)}
    </svg>
  );
}
