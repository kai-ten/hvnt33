// Public release metadata for the Download page. The browser calls this
// same-origin function; it returns only validated HVNT33 assets and caches the
// answer at the edge, rather than exposing GitHub's full API response.
const DEFAULT_API = "https://api.github.com/repos/kai-ten/hvnt33/releases?per_page=10";
const RELEASE_PREFIX = "https://github.com/kai-ten/hvnt33/releases/";
const ASSET = /^HVNT33-(\d+\.\d+\.\d+)-(arm64|x64|x86_64|amd64)\.(dmg|exe|AppImage|deb)$/;

export interface DownloadAsset {
  name: string;
  url: string;
  size: number;
  digest: string;
  arch: string;
  format: string;
}

export interface DownloadRelease {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  assets: DownloadAsset[];
}

const json = (status: number, body: unknown, cache = "no-store") => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" },
});

export function publicRelease(value: unknown): DownloadRelease | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const release = item as Record<string, unknown>;
    if (release.draft === true || typeof release.tag_name !== "string" || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
    if (typeof release.html_url !== "string" || !release.html_url.startsWith(RELEASE_PREFIX)) continue;
    if (typeof release.published_at !== "string" || !Number.isFinite(Date.parse(release.published_at))) continue;
    const assets: DownloadAsset[] = [];
    for (const raw of Array.isArray(release.assets) ? release.assets : []) {
      if (!raw || typeof raw !== "object") continue;
      const asset = raw as Record<string, unknown>;
      const match = typeof asset.name === "string" ? ASSET.exec(asset.name) : null;
      if (!match || typeof asset.browser_download_url !== "string" || !asset.browser_download_url.startsWith(`${RELEASE_PREFIX}download/`)) continue;
      assets.push({
        name: asset.name as string,
        url: asset.browser_download_url,
        size: typeof asset.size === "number" && asset.size >= 0 ? asset.size : 0,
        digest: typeof asset.digest === "string" && /^sha256:[a-f0-9]{64}$/.test(asset.digest) ? asset.digest : "",
        arch: match[2],
        format: match[3],
      });
    }
    if (!assets.length) continue;
    return {
      version: release.tag_name.slice(1),
      name: typeof release.name === "string" && release.name.trim() ? release.name.trim().slice(0, 160) : release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
      prerelease: release.prerelease === true,
      assets,
    };
  }
  return null;
}

const handler = {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    try {
      const response = await fetch(process.env.GITHUB_RELEASES_API_URL || DEFAULT_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "hvnt33.com" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const release = publicRelease(await response.json());
      if (!release) return json(404, { error: "No published release is available yet." }, "public, max-age=60, s-maxage=300");
      return json(200, release, "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
    } catch (error) {
      console.error("release metadata failed", error instanceof Error ? error.message : String(error));
      return json(502, { error: "Release information is temporarily unavailable." });
    }
  },
};

export default handler;
