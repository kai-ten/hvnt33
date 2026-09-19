import Image from "next/image";
import Link from "next/link";
import { blob, github, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="site-footer mt-24">
      <div className="wrap py-12 grid gap-10 md:grid-cols-[1fr_auto]">
        <div className="flex gap-4 items-start">
          {/* The mark: the same file as the favicon, so it is already cached. */}
          <Image src="/icon.svg" alt="" width={56} height={56} className="flex-none w-14 h-14" />
          <div>
            <p className="display text-2xl tracking-[0.14em]">HVNT33</p>
            <p className="dim mt-2 max-w-md text-[0.95rem]">{site.category}. Free software under the <a href={blob("LICENSE")} rel="noopener noreferrer">GNU AGPL v3</a>.</p>
          </div>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-1 text-[0.95rem] content-start">
          <Link href="/download">Download</Link>
          <Link href="/cloud">Cloud</Link>
          <Link href="/investigations">Investigations</Link>
          <a href={site.discord} target="_blank" rel="noopener noreferrer">Community</a>
          <Link href="/features">Features</Link>
          <Link href="/security">Security</Link>
          <Link href="/changelog">Changelog</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/privacy">Privacy</Link>
          <a href={github} rel="noopener noreferrer">Source</a>
          <a href={blob("CONTRIBUTING.md")} rel="noopener noreferrer">Contributing</a>
        </nav>
      </div>
    </footer>
  );
}
