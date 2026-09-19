import { shots } from "@/lib/shots";

// A plate: a real screenshot, bordered, captioned like a printed figure.
export function Figure({ shot, number, className = "", priority = false }: { shot: string; number?: number; className?: string; priority?: boolean }) {
  const s = shots[shot];
  if (!s) throw new Error(`no screenshot "${shot}"`);
  const srcSet = (ext: string) => s.widths.map(w => `/shots/${shot}-${w}.${ext} ${w}w`).join(", ");
  const sizes = "(min-width: 78rem) 44rem, (min-width: 56rem) 58vw, calc(100vw - 2rem)";
  return (
    <figure className={`plate ${className}`}>
      <picture>
        {s.phone ? <source media="(max-width: 40rem)" srcSet={s.phone.widths.map(w => `/shots/${shot}-phone-${w}.avif ${w}w`).join(", ")} type="image/avif" sizes="calc(100vw - 2rem)" /> : null}
        <source srcSet={srcSet("avif")} type="image/avif" sizes={sizes} />
        <source srcSet={srcSet("webp")} type="image/webp" sizes={sizes} />
        <img src={`/shots/${shot}-${s.widths[0]}.webp`} width={s.width} height={s.height} alt={s.alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />
      </picture>
      <figcaption className="meta">{number ? `Fig. ${number}. ` : ""}{s.caption}</figcaption>
    </figure>
  );
}
