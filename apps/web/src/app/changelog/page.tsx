import type { Metadata } from "next";
import { DocsShell } from "@/components/DocsShell";
import { PageHead } from "@/components/PageHead";
import { Prose } from "@/components/Prose";
import { renderFile } from "@/lib/markdown";

export const metadata: Metadata = { title: "Changelog", description: "What changed in HVNT33, release by release." };

export default async function Changelog() {
  const { html } = await renderFile("CHANGELOG.md");
  return (
    <DocsShell current="changelog">
      <PageHead title="Changelog" running={<><span lang="la">Liber</span> · Changelog</>} />
      <Prose html={html} />
    </DocsShell>
  );
}
