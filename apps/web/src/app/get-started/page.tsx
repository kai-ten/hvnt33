import type { Metadata } from "next";
import Link from "next/link";
import { K } from "@/components/Keys";
import { PageHead } from "@/components/PageHead";
import { Prose } from "@/components/Prose";
import { Terminal } from "@/components/Terminal";
import { installGuide } from "@/lib/install";
import { render } from "@/lib/markdown";
import { github } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download",
  description: "Download and run the HVNT33 investigation browser on macOS, Windows or Linux.",
  alternates: { canonical: "/download" },
};

// Install text may mark names in `backticks`: they are set as code.
const fmt = (s: string) => s.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const checks: [RegExp, string][] = [
  [/^Node\.js/, "node --version"],
  [/^Claude Code/, "claude --version"],
];

const trouble: { symptom: string; fix: React.ReactNode }[] = [
  { symptom: "npm install fails, or node complains about syntax", fix: <>Your Node.js is older than 22.18. Check with <code>node --version</code> and install a current LTS release.</> },
  { symptom: "npm run desktop takes a while the first time", fix: <>It builds the app first. Later starts are quicker.</> },
  { symptom: "Tor on doesn't connect", fix: <>Built-in Tor is installed by <code>npm run setup</code>; run it again if it was interrupted. The button shows Tor&rsquo;s progress; the first start takes longest.</> },
  { symptom: "An engine tab shows a consent page or a bot check", fix: <>HVNT33 reports these and never bypasses them. Complete it in the tab and the reload is recorded. VPN and Tor exits see more of them.</> },
  { symptom: "Captures don't get filed", fix: <>Filing needs Claude Code or Codex signed in, in the terminal at the bottom of the window (<K>⌘J</K>), and <b>Agent files it</b> ticked in the capture sheet.</> },
];

export default async function GetStarted() {
  const guide = installGuide();
  const first = await render(guide.firstInvestigation, "README.md");
  return (
    <div className="wrap">
      <PageHead title="Download HVNT33" running={<span lang="la">Incipit.</span>}>
        <p>At the end of this page you&rsquo;ll have HVNT33 open with a fictional demo case to explore. The app brings its own server, database and Tor; all you need is Node.js.</p>
        <p className="meta mt-4">Signed installers are coming. Today, download the source and build the app with the steps below.</p>
      </PageHead>

      <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-16">
        <div className="min-w-0">
          <section aria-labelledby="need" className="border-t border-rule pt-8">
            <h2 id="need" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">What you need</h2>
            <ul className="mt-6 grid gap-4">
              <li className="grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-6 border-b border-rule pb-4">
                <span>A computer running macOS, Windows or Linux</span>
              </li>
              {guide.requirements.map(r => {
                const check = checks.find(([re]) => re.test(r))?.[1];
                return (
                  <li key={r} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-6 border-b border-rule pb-4">
                    <span>{r.replace(/\s*\(`?[a-z]+ --version`?\)$/, "")}</span>
                    {check ? <code className="justify-self-start">{check}</code> : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="steps" className="mt-16 border-t border-rule pt-8">
            <h2 id="steps" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">Install and start</h2>
            <ol className="mt-4">
              {guide.steps.map((s, i) => (
                <li key={s.id} id={s.id} className="py-8 border-b border-rule last:border-0" data-reveal>
                  <h3 className="display text-[1.35rem]">
                    <span className="num">{roman[i]}</span>{s.title}{s.optional ? <span className="dim font-serif normal-case tracking-normal text-[1.05rem]"> (optional)</span> : null}
                  </h3>
                  <p className="mt-3 max-w-[62ch]">{fmt(s.explain)}</p>
                  <div className="mt-4"><Terminal label={s.title} lines={s.commands.map(c => ({ command: c.command }))} /></div>
                  <p className="mt-3 meta"><span className="text-ink">When it worked:</span> {fmt(s.expect)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="first" className="mt-16 border-t border-rule pt-8">
            <h2 id="first" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">Your first investigation</h2>
            <Prose html={first.html} className="mt-6" />
          </section>

          <section aria-labelledby="wrong" className="mt-16 border-t border-rule pt-8">
            <h2 id="wrong" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">When something goes wrong</h2>
            <dl className="mt-6">
              {trouble.map(t => (
                <div key={t.symptom} className="py-5 border-b border-rule last:border-0">
                  <dt className="font-code text-[0.9rem]">{t.symptom}</dt>
                  <dd className="mt-2 max-w-[62ch] dim">{t.fix}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6">Still stuck? <a href={`${github}/issues`} rel="noopener noreferrer">Open an issue</a> with the command, what it printed, and your macOS and Node versions.</p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 self-start" aria-label="Next">
          <h2 className="caps text-[1.1rem] dim">Next</h2>
          <ul className="mt-3 grid gap-2">
            <li><Link href="/docs/using-hvnt33">Using HVNT33</Link></li>
            <li><Link href="/docs/desktop">The desktop app, feature by feature</Link></li>
            <li><Link href="/docs/agent-workflow">How the agent files captures</Link></li>
            <li><Link href="/docs/operations">Backups, storage and server modes</Link></li>
          </ul>
          <p className="meta mt-6">The commands on this page are read from the repository&rsquo;s README when the site is built, so they match the code you clone.</p>
        </aside>
      </div>
    </div>
  );
}
