/** The nursery's logo (uploaded or supplied with the app). Renders nothing when there is none. */
export function LogoMark({ src, className = "size-16", alt = "" }: { src?: string | null; className?: string; alt?: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`${className} object-contain`} />;
}
