import fs from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const dynamic = "force-static";

const size = { width: 1200, height: 630 };

// The link preview image, rendered once at build time.
export async function GET() {
  const font = await fs.readFile(path.join(process.cwd(), "assets/fonts/src/CastoroTitling-Regular.ttf"));
  // An image has no screen reader text to keep: draw the Roman V directly.
  const roman = (s: string) => s.replace(/u/g, "v").replace(/U/g, "V");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ebe5d8", color: "#1d1a16", padding: "72px 80px", fontFamily: "Titling" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, letterSpacing: 6 }}>
          <svg width="56" height="56" viewBox="0 0 64 64"><g fill="none" stroke="#a3261a"><circle cx="32" cy="32" r="29" strokeWidth="2.5" /><circle cx="32" cy="32" r="24.5" strokeWidth="1.25" /><path d="M19 20h7.5M37.5 20H45M22.5 20L32 46.5 41.5 20" strokeWidth="3" /></g></svg>
          HVNT33
        </div>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.08, maxWidth: 1040, textTransform: "uppercase", letterSpacing: 2 }}>{roman(site.line)}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 32, color: "#5a5245", borderTop: "2px solid #857760", paddingTop: 24 }}>
          <span>{roman(site.category)}</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Titling", data: font, style: "normal", weight: 400 }] },
  );
}
