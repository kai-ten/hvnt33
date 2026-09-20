"use client";
import { useEffect, useMemo, useState } from "react";
import { github } from "@/lib/site";

interface Asset { name: string; url: string; size: number; digest: string; arch: string; format: string }
interface Release { version: string; name: string; url: string; publishedAt: string; prerelease: boolean; assets: Asset[] }

const details = (asset: Asset) => {
  if (asset.format === "dmg") return asset.arch === "arm64" ? ["macOS", "Apple Silicon", "DMG"] : ["macOS", "Intel", "DMG"];
  if (asset.format === "exe") return ["Windows", "Intel / AMD 64-bit", "Installer"];
  if (asset.format === "AppImage") return ["Linux", "Intel / AMD 64-bit", "AppImage"];
  return ["Linux", "Debian / Ubuntu 64-bit", "DEB"];
};

const likely = (asset: Asset, platform: string) => (
  (platform === "mac" && asset.format === "dmg") ||
  (platform === "windows" && asset.format === "exe") ||
  (platform === "linux" && asset.format === "AppImage")
);

export function ReleaseDownloads() {
  const [release, setRelease] = useState<Release | null>(null);
  const [failed, setFailed] = useState(false);
  const [platform, setPlatform] = useState("");
  useEffect(() => {
    fetch("/api/release", { headers: { Accept: "application/json" } })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => {
        const ua = navigator.userAgent;
        // Safari and Chromium deliberately do not expose Apple Silicon
        // reliably, so recommend both Mac builds rather than mislabelling one.
        setPlatform(/Mac/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : "");
        setRelease(data);
      })
      .catch(() => setFailed(true));
  }, []);
  const assets = useMemo(() => release?.assets.slice().sort((a, b) => Number(likely(b, platform)) - Number(likely(a, platform))) ?? [], [release, platform]);

  return (
    <section aria-labelledby="installers" className="mb-16 border-t border-rule pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="installers" className="display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)]">Signed installers</h2>
        {release ? <p className="meta">Latest: v{release.version}{release.prerelease ? " · Pre-release" : ""} · {new Date(release.publishedAt).toLocaleDateString()}</p> : null}
      </div>
      {!release && !failed ? <p className="mt-5 dim" role="status">Looking for the latest published release…</p> : null}
      {!release && failed ? (
        <div className="mt-5 border border-rule p-5">
          <p>No published installer is available right now. You can still build from source below.</p>
          <p className="mt-3"><a className="btn btn-quiet" href={`${github}/releases`} rel="noopener noreferrer">View GitHub releases</a></p>
        </div>
      ) : null}
      {release ? (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {assets.map(asset => {
              const [system, architecture, format] = details(asset);
              const recommended = likely(asset, platform);
              return (
                <article key={asset.name} className={`border p-5 ${recommended ? "border-rubric" : "border-rule"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div><h3 className="font-sans font-semibold text-[1.15rem]">{system}</h3><p className="meta mt-1">{architecture} · {format} · {(asset.size / 1_000_000).toFixed(0)} MB</p></div>
                    {recommended ? <span className="caps text-rubric text-[0.7rem]">For this computer</span> : null}
                  </div>
                  <p className="mt-5"><a className="btn btn-primary" href={asset.url}>Download v{release.version}</a></p>
                  {asset.digest ? <details className="mt-4"><summary className="meta cursor-pointer">SHA-256 checksum</summary><code className="mt-2 block break-all">{asset.digest.slice(7)}</code></details> : null}
                </article>
              );
            })}
          </div>
          <p className="meta mt-5">macOS builds are signed, notarized and stapled. Verify any download against its SHA-256 value before installing. <a href={release.url} rel="noopener noreferrer">Release notes</a>.</p>
        </>
      ) : null}
    </section>
  );
}
