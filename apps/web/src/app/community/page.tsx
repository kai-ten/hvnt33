import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { Tessera } from "@/components/Ornaments";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Community",
  description: "The HVNT33 Discord for investigators comparing methods, testing the browser and building the public investigation archive.",
};

const rooms = [
  { title: "Use the browser", body: "Ask questions, report rough edges and compare practical research methods." },
  { title: "Show your work", body: "Share public investigations, archival finds and reproducible techniques." },
  { title: "Build the archive", body: "Help shape how cases are stored, shared, followed and published through HVNT33 Cloud." },
];

export default function Community() {
  return (
    <div className="wrap">
      <PageHead title="A place to compare methods">
        <p>The HVNT33 Discord brings together people who investigate in public, preserve what they find and care about showing their work.</p>
        <div className="mt-7">
          {site.discord ? (
            <a href={site.discord} className="btn btn-primary" target="_blank" rel="noopener noreferrer">Join the Discord</a>
          ) : (
            <span className="btn btn-quiet" aria-disabled="true">Discord opens soon</span>
          )}
        </div>
      </PageHead>

      <section aria-labelledby="inside" className="border-t border-rule pt-8">
        <h2 id="inside" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">Inside the community</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {rooms.map(room => (
            <div key={room.title} className="border-t border-rule pt-5" data-reveal>
              <h3 className="caps text-[1.05rem] flex items-center"><Tessera />{room.title}</h3>
              <p className="mt-3 dim">{room.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="boundary" className="mt-20 md:mt-28 grid gap-10 lg:grid-cols-2 lg:gap-16 border-t border-rule pt-8">
        <div>
          <h2 id="boundary" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">Conversation is not evidence storage</h2>
          <p className="mt-5 max-w-[58ch]">Discord is a public community space. Do not post private sources, credentials, personal data or unpublished case material. Keep sensitive research inside the browser and its evidence vault.</p>
        </div>
        <div>
          <h2 className="caps text-[1.05rem]">For founding members</h2>
          <p className="mt-3 dim max-w-[58ch]">Founding members receive private channels for hosted builds, onboarding and product decisions. Confirmed software defects remain in the public issue tracker so they can be found and fixed.</p>
          <p className="mt-5"><Link href="/cloud">Read about the Founding 100</Link>.</p>
        </div>
      </section>
    </div>
  );
}
