import type { MetadataRoute } from "next";
import { posts } from "@/lib/investigations";
import { docPages } from "@/lib/markdown";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", "/download", "/features", "/investigations", ...posts().map(p => `/investigations/${p.slug}`), "/cloud", "/community", "/docs", ...docPages.map(d => `/docs/${d.slug}`), "/security", "/changelog", "/privacy"];
  return paths.map(p => ({ url: `${site.url}${p}` }));
}
