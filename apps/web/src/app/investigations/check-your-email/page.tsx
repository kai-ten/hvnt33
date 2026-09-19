import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Check your email", robots: { index: false } };

export default function CheckYourEmail() {
  return (
    <div className="wrap">
      <PageHead title="Check your email">
        <p>We sent you a link. Click it to confirm, and the next investigation comes to your inbox. It expires in 7 days.</p>
      </PageHead>
      <p><Link href="/investigations">Back to Investigations</Link></p>
    </div>
  );
}
