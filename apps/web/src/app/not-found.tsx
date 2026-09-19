import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap pt-24 pb-16">
      <p className="display text-rubric text-[clamp(3rem,2rem+5vw,6rem)]" lang="la">Non inventum.</p>
      <h1 className="mt-4 text-[1.4rem]">The page isn&rsquo;t here.</h1>
      <p className="mt-4 dim max-w-[52ch]">It may have moved, or the link may be wrong. The <Link href="/docs">manual</Link> and the <Link href="/features">features</Link> are good places to pick up the trail.</p>
    </div>
  );
}
