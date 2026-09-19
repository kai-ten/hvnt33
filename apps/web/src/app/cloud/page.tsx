import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Tessera } from "@/components/Ornaments";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Cloud",
  description: "Join the first 100 members building HVNT33 Cloud: hosted investigations, private collaboration and source-linked public publishing.",
};

const foundingBenefits = [
  "One year of HVNT33 Cloud from the day your account is activated",
  "Hosted cases available across your computers",
  "Private collaboration and controlled read-only sharing",
  "Publishing tools for source-linked public investigations",
  "Private Founders channels and direct input into the product",
  "A complete export of your research at any time",
];

const visibility = [
  { title: "Private", body: "Only you can open the case. Cloud storage never makes an investigation public by default." },
  { title: "Shared", body: "Invite trusted collaborators or give someone controlled, read-only access." },
  { title: "Published", body: "Select the records, sources and archived pages that are ready to become a public investigation." },
];

export default function Cloud() {
  return (
    <>
      <section className="cloud-hero" aria-labelledby="founding-title">
        <div className="cloud-founder-mosaic" aria-hidden="true">
          <Image
            src="/images/cloud-founding-senate.avif"
            alt=""
            fill
            priority
            sizes="(min-width: 832px) 42vw, 100vw"
          />
        </div>
        <div className="wrap relative">
          <div className="cloud-offer">
            <h1 id="founding-title" className="display">{site.founding.name}</h1>
            <p className="mt-6 text-[1.3rem] leading-snug max-w-[38ch]">Help build the hosted home for the investigation browser.</p>

            <div className="cloud-price mt-8 border-y border-rule py-6">
              <p className="font-code"><span className="display text-[clamp(3rem,2rem+4vw,5.6rem)]">${site.founding.price}</span> <span className="dim">for the first year</span></p>
              <p className="mt-2 dim max-w-[48ch]">Pay now. Your year begins when your Cloud account is activated, not when you purchase.</p>
            </div>

            <ul className="mt-7 grid gap-3 max-w-[46rem]">
              {foundingBenefits.slice(0, 4).map(item => (
                <li key={item} className="founding-benefit"><span aria-hidden="true">◆</span>{item}</li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              {site.founding.checkout ? (
                <a href={site.founding.checkout} className="btn btn-primary" rel="noopener noreferrer">Become a founding member</a>
              ) : (
                <span className="btn btn-quiet" aria-disabled="true">Membership opens soon</span>
              )}
              <Link href="/download" className="btn btn-quiet">Download the browser</Link>
            </div>
            <p className="meta mt-5 max-w-[64ch]">Cloud is in development. Request a full refund before activation or within 30 days afterward. HVNT33 Desktop remains open source and works without Cloud.</p>
          </div>
        </div>
      </section>

      <section className="wrap mt-20 md:mt-28" aria-labelledby="archive-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,5fr)] lg:gap-16 items-center">
          <figure className="archive-image" data-reveal>
            <Image
              src="/images/cloud-investigation-archive.avif"
              alt="A stone mosaic of maps, records and photographs being joined into a shared archive"
              width={1600}
              height={1067}
              sizes="(min-width: 1024px) 58vw, 100vw"
            />
            <figcaption className="meta mt-3">Public pieces become durable research when their sources and connections stay with them.</figcaption>
          </figure>
          <div data-reveal>
            <h2 id="archive-title" className="display text-[clamp(2rem,1.3rem+2vw,3.2rem)]">An archive built from investigations</h2>
            <p className="mt-6 text-[1.2rem]">The long-term aim is a social archive where people follow investigations, inspect the evidence, contribute public pieces and build on work that came before.</p>
            <p className="mt-5 dim">Unlike a feed of unsupported claims, each published finding keeps its source, archived page and place in the case. Other investigators can see what is known, what remains disputed and where to continue.</p>
          </div>
        </div>
      </section>

      <section className="wrap mt-20 md:mt-28 border-t border-rule pt-8" aria-labelledby="why-one-hundred">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <h2 id="why-one-hundred" className="display text-[clamp(2rem,1.3rem+2vw,3.2rem)]" data-reveal>Why one hundred</h2>
          <div data-reveal>
            <p className="text-[1.2rem]">According to Roman tradition, Romulus chose one hundred counsellors and called their assembly the Senate. The story belongs to Rome&rsquo;s foundation legend, but the number endured as a civic symbol. The United States Senate also has one hundred members today, two from each state.</p>
            <p className="mt-5 dim">One hundred is a fitting size for HVNT33&rsquo;s founding group: small enough to know who helped shape it, and large enough to begin a lasting public institution.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="choice" className="wrap mt-20 md:mt-28 border-t border-rule pt-8">
        <h2 id="choice" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">You choose what leaves your computer</h2>
        <p className="mt-5 max-w-[62ch] dim">The browser remains local-first. Cloud is an option for cases you want to keep online, work on with others or publish. Raw research and public work remain separate.</p>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {visibility.map((item, i) => (
            <li key={item.title} className="border-t border-rule pt-5" data-reveal>
              <h3 className="caps text-[1.05rem] flex items-center"><Tessera />{item.title}</h3>
              <p className="mt-3 dim">{item.body}</p>
              <p className="meta mt-4">{["I", "II", "III"][i]}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="everything" className="wrap mt-20 md:mt-28 border-t border-rule pt-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h2 id="everything" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">Founding membership</h2>
            <p className="mt-5 dim">The first {site.founding.limit} members fund the hosted service and help decide how investigators store, share and publish their work.</p>
          </div>
          <ul className="border-t border-rule">
            {foundingBenefits.map(item => <li key={item} className="py-4 border-b border-rule flex gap-3"><span className="text-rubric" aria-hidden="true">◆</span><span>{item}</span></li>)}
          </ul>
        </div>
        <div className="mt-8 flex flex-wrap gap-4">
          {site.founding.checkout ? (
            <a href={site.founding.checkout} className="btn btn-primary" rel="noopener noreferrer">Become a founding member</a>
          ) : (
            <span className="btn btn-quiet" aria-disabled="true">Membership opens soon</span>
          )}
          <Link href="/community" className="btn btn-quiet">Meet the community</Link>
        </div>
      </section>
    </>
  );
}
