import Link from "next/link";
import { Figure } from "@/components/Figure";
import { Tessera } from "@/components/Ornaments";
import { Mosaic } from "@/components/Mosaic";
import { Story } from "@/components/Story";
import { Terminal } from "@/components/Terminal";
import { features } from "@/lib/features";
import { installGuide } from "@/lib/install";
import { shots } from "@/lib/shots";
import { site } from "@/lib/site";

const heading = "display text-[clamp(1.9rem,1.3rem+2.2vw,3.4rem)]";

export default function Home() {
  const guide = installGuide();
  const quick = guide.steps.filter(s => !s.optional).flatMap(s => s.commands.map(c => ({ command: c.command })));
  const homeFeatures = features.filter(f => f.home);
  return (
    <>
      <section className="hero-mosaic" aria-labelledby="line">
        <Mosaic />
        <div className="wrap relative">
          <div className="hero-copy">
            <h1 id="line" className="display">{site.line}</h1>
            <p className="mt-8 text-[1.3rem] md:text-[1.55rem] leading-snug max-w-[34ch] rise" style={{ animationDelay: "350ms" }}>{site.audience}</p>
            <div className="mt-9 flex flex-wrap gap-3 rise" style={{ animationDelay: "650ms" }}>
              <Link href="/download" className="btn btn-primary">Download HVNT33</Link>
              <Link href="/cloud" className="btn btn-quiet">The Founding 100</Link>
            </div>
            <p className="meta mt-6 rise" style={{ animationDelay: "800ms" }}>{site.platform} · Open source</p>
          </div>
        </div>
      </section>
      <div className="meander" aria-hidden="true" />

      <Story />

      {shots.search ? (
        <div className="wrap mt-24" data-reveal>
          <Figure shot="search" number={1} />
        </div>
      ) : null}

      <section className="wrap mt-24 md:mt-36 ledger-wrap" aria-labelledby="what">
        <h2 id="what" className={heading} data-reveal>What it does</h2>
        <p className="mt-5 max-w-[60ch] dim" data-reveal>Six of the fourteen things HVNT33 does today. Each one links to the part of the manual that shows how.</p>
        <ol className="ledger ledger-home mt-10">
          {homeFeatures.map((f, i) => (
            <li key={f.id} data-reveal>
              <article className="inscription">
                <span className="carved" aria-hidden="true" data-n={["I", "II", "III", "IV", "V", "VI"][i]} />
                <h3>{f.title}</h3>
                <div>
                  <p className="max-w-[60ch]">{f.body}</p>
                  {f.note ? <p className="note mt-4 max-w-[60ch]"><span className="dagger" aria-hidden="true">†</span>{f.note}</p> : null}
                  <p className="mt-4"><Link href={f.doc.href}>{f.doc.label} in the docs</Link></p>
                </div>
              </article>
            </li>
          ))}
        </ol>
        <p className="border-t border-rule pt-8 text-[1.15rem]"><span aria-hidden="true" className="text-rubric mr-2">☞</span><Link href="/features">All fourteen features</Link></p>
      </section>

      <section className="wrap mt-28 md:mt-40" aria-labelledby="stance">
        <h2 id="stance" className={heading} data-reveal>Research you can stand behind</h2>
        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-14">
          <div className="border-t border-rule pt-6" data-reveal>
            <h3 className="caps text-[1.05rem] flex items-center"><Tessera />It stays on your machine</h3>
            <p className="mt-3 dim">Local cases live in ArcadeDB and a checksummed evidence vault on your computer. They need no HVNT33 account, and the browser sends no telemetry. It contacts other services only to do what you ask: the engines you search, the Internet Archive, and two timestamp authorities that receive nothing but a hash.</p>
          </div>
          <div className="border-t border-rule pt-6" data-reveal>
            <h3 className="caps text-[1.05rem] flex items-center"><Tessera />Filing is not verifying</h3>
            <p className="mt-3 dim">The agent organizes; it doesn&rsquo;t vouch. Every record keeps the quote and capture it came from, and stays Unverified until a person checks it. Human reviews are recorded apart from agent filing, so anyone can see which is which.</p>
          </div>
          <div className="border-t border-rule pt-6" data-reveal>
            <h3 className="caps text-[1.05rem] flex items-center"><Tessera />Proof that doesn&rsquo;t need HVNT33</h3>
            <p className="mt-3 dim">An evidence package holds the archive, the text, a screenshot, a manifest and the timestamp tokens. Anyone can check it with standard tools:</p>
            <div className="mt-4">
              <Terminal label="Verify an evidence package" lines={[
                { command: "shasum -a 256 -c SHA256SUMS" },
                { command: "openssl ts -verify -data manifest.json -in timestamps/1-timestamp.digicert.com.tsr -CAfile /etc/ssl/cert.pem" },
              ]} />
            </div>
          </div>
        </div>
      </section>

      <section className="wrap mt-28 md:mt-40 ledger-wrap" aria-labelledby="cloud">
        <h2 id="cloud" className={heading} data-reveal>Keep the investigation alive</h2>
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-16 items-start">
          <div data-reveal>
            <p className="text-[1.25rem] max-w-[54ch]">HVNT33 Cloud will keep cases available across computers, let trusted collaborators examine the evidence, and give selected investigations a permanent public home.</p>
            <p className="mt-5 dim max-w-[62ch]">The browser stays local-first. You choose which cases leave your computer, who can see them, and which records are ready to publish. Private research, shared work and public investigations remain separate.</p>
            <p className="mt-7"><Link href="/cloud" className="btn btn-primary">See the Founding 100</Link></p>
          </div>
          <div className="border-t border-rule pt-6" data-reveal>
            <h3 className="caps text-[1.05rem] flex items-center"><Tessera />An archive made by investigators</h3>
            <p className="mt-3 dim">The long-term aim is a public network of source-linked investigations: people can follow a case, inspect its evidence, build on prior work and preserve material the web may lose.</p>
          </div>
        </div>
      </section>

      <section className="wrap mt-28 md:mt-40" aria-labelledby="published">
        <h2 id="published" className={heading} data-reveal>Investigations, with the receipts</h2>
        <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-14 items-start">
          <p className="text-[1.2rem] max-w-[54ch]" data-reveal>Published investigations show what was found, where each piece came from and how it fits. They are also sent as a quiet newsletter when there is something worth publishing.</p>
          <div className="flex flex-wrap gap-3 lg:justify-end" data-reveal>
            <Link href="/investigations" className="btn btn-primary">Read investigations</Link>
            <Link href="/community" className="btn btn-quiet">Join the community</Link>
          </div>
        </div>
      </section>

      <section className="wrap mt-28 md:mt-40" aria-labelledby="run">
        <h2 id="run" className={heading} data-reveal>Open the browser tonight</h2>
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start" data-reveal>
          <div>
            <p className="max-w-[48ch]">Download one app for macOS, Windows or Linux. The server, database and Tor are built in; no Node.js or Docker is needed unless you choose to build the source yourself.</p>
            <p className="mt-6"><Link href="/download" className="btn btn-primary">Download and install</Link></p>
          </div>
          <Terminal label="Install and start HVNT33" lines={quick} />
        </div>
      </section>
    </>
  );
}
