import type { Metadata, Viewport } from "next";
import { Castoro, Castoro_Titling, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Reveals } from "@/components/Reveals";
import { site } from "@/lib/site";
import "./globals.css";

const themeBootstrap = `document.documentElement.classList.add("js");try{const theme=localStorage.getItem("theme");if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}`;

// next/font downloads these at build time and serves them from this site;
// no visitor request ever goes to Google.
const titling = Castoro_Titling({ weight: "400", subsets: ["latin"], variable: "--font-titling", display: "swap" });
const castoro = Castoro({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-castoro", display: "swap" });
const plex = IBM_Plex_Sans({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-plex", display: "swap", preload: false });
const plexMono = IBM_Plex_Mono({ weight: "400", subsets: ["latin"], variable: "--font-plex-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `HVNT33 · ${site.category}`, template: "%s · HVNT33" },
  description: site.description,
  applicationName: "HVNT33",
  openGraph: { type: "website", siteName: "HVNT33", url: site.url, title: `HVNT33 · ${site.category}`, description: site.description, images: [{ url: "/og.png", width: 1200, height: 630, alt: `HVNT33: ${site.line}` }] },
  twitter: { card: "summary_large_image" },
  referrer: "no-referrer",
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#ebe5d8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${titling.variable} ${castoro.variable} ${plex.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <link rel="preload" href="/fonts/vu-CastoroTitling-Regular.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <Reveals />
      </body>
    </html>
  );
}
