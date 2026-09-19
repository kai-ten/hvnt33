import type { Metadata } from "next";
import { DocsShell, PhoneToc } from "@/components/DocsShell";
import { PageHead } from "@/components/PageHead";
import { Prose } from "@/components/Prose";
import { parse, readRepoFile, render, renderFile, section } from "@/lib/markdown";

export const metadata: Metadata = { title: "Security", description: "How HVNT33 keeps web pages away from your files, terminal and API, and how to report a vulnerability." };

export default async function Security() {
  const policy = await renderFile("SECURITY.md");
  const model = await render(section(parse(readRepoFile("apps/desktop/README.md")), "Security model"), "apps/desktop/README.md");
  return (
    <DocsShell current="security" toc={policy.toc}>
      <PageHead title="Security" running={<><span lang="la">Liber</span> · Security</>}>
        <p>How HVNT33 keeps hostile pages away from your files, your terminal and your research, and how to report a vulnerability.</p>
      </PageHead>
      <PhoneToc toc={policy.toc} />
      <section aria-labelledby="model" className="prose">
        <h2 id="model">The desktop app&rsquo;s security model</h2>
      </section>
      <Prose html={model.html} className="mt-4" />
      <Prose html={policy.html} className="mt-4" />
    </DocsShell>
  );
}
