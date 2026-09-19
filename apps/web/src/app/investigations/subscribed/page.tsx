import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Subscribed", robots: { index: false } };

export default function Subscribed() {
  return (
    <div className="wrap">
      <PageHead title="You're subscribed">
        <p>The next investigation comes to your inbox when it&rsquo;s published. Every email has a link to unsubscribe.</p>
      </PageHead>
      <p><Link href="/investigations">Read the investigations</Link></p>
    </div>
  );
}
