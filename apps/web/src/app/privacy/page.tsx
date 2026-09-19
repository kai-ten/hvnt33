import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Privacy", description: "This site sets no cookies, runs no analytics and loads nothing from anyone else. The app sends no telemetry." };

export default function Privacy() {
  return (
    <div className="wrap">
      <PageHead title="Privacy" />
      <div className="prose">
        <p>This site sets no cookies, runs no analytics and loads nothing from any other domain. Its fonts and images are served from here. The only thing it keeps in your browser is whether you chose the dark or light theme, and that never leaves your browser.</p>
        <p>If you subscribe to Investigations, your email address is kept by Resend, the service that sends the emails, and used for nothing but sending you new investigations. Nothing is stored until you click the confirmation link. Every email has a link to unsubscribe, and unsubscribing takes effect immediately.</p>
        <p>Docs search runs in your browser over an index that ships with the site. What you type isn&rsquo;t sent anywhere.</p>
        <p>The site is hosted on Vercel, which keeps standard request logs (including IP addresses) to run its service. We don&rsquo;t use those logs to build profiles, and there&rsquo;s nothing else to collect.</p>
        <p>Local use of the HVNT33 app sends no telemetry and needs no HVNT33 account. Cloud accounts will have a separate privacy notice before founding memberships open. What the browser contacts, and when, is set out in <Link href="/docs/architecture#trust-boundaries">the architecture&rsquo;s trust boundaries</Link>.</p>
      </div>
    </div>
  );
}
