import type { Metadata } from "next";
import { PageHead } from "@/components/PageHead";
import { Subscribe } from "@/components/Subscribe";

export const metadata: Metadata = { title: "Link expired", robots: { index: false } };

export default function LinkExpired() {
  return (
    <div className="wrap">
      <PageHead title="That link didn't work">
        <p>Confirmation links expire after 7 days, and only work once they arrive whole. Subscribe again and we&rsquo;ll send a fresh one.</p>
      </PageHead>
      <div className="max-w-[40rem]"><Subscribe /></div>
    </div>
  );
}
