// Strict parsing for release data received from GitHub. Update metadata is
// untrusted network input: only ordinary SemVer tags and this repository's
// own release pages are allowed through to the app interface.
export interface PublicRelease {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const RELEASE = "https://github.com/kai-ten/hvnt33/releases/tag/";

type Parsed = { numbers: [number, number, number]; prerelease: string[] };

function parse(value: string): Parsed | null {
  const match = VERSION.exec(value.trim());
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number) as [number, number, number];
  if (numbers.some(n => !Number.isSafeInteger(n))) return null;
  return { numbers, prerelease: match[4]?.split(".") ?? [] };
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const a = parse(current), b = parse(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b.numbers[i] !== a.numbers[i]) return b.numbers[i] > a.numbers[i];
  }
  if (!b.prerelease.length) return a.prerelease.length > 0;
  if (!a.prerelease.length) return false;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const left = a.prerelease[i], right = b.prerelease[i];
    if (left === right) continue;
    if (left === undefined) return true;
    if (right === undefined) return false;
    const an = /^\d+$/.test(left), bn = /^\d+$/.test(right);
    if (an && bn) return Number(right) > Number(left);
    if (an !== bn) return !bn;
    return right.localeCompare(left) > 0;
  }
  return false;
}

export function newestPublicRelease(value: unknown): PublicRelease | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const release = item as Record<string, unknown>;
    if (release.draft === true || typeof release.tag_name !== "string" || !parse(release.tag_name)) continue;
    if (typeof release.html_url !== "string" || !release.html_url.startsWith(RELEASE)) continue;
    if (typeof release.published_at !== "string" || !Number.isFinite(Date.parse(release.published_at))) continue;
    return {
      version: release.tag_name.replace(/^v/, ""),
      name: typeof release.name === "string" && release.name.trim() ? release.name.trim().slice(0, 160) : release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
      prerelease: release.prerelease === true,
    };
  }
  return null;
}
