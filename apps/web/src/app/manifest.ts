import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HVNT33",
    short_name: "HVNT33",
    description: site.description,
    start_url: "/",
    display: "browser",
    background_color: "#0e0c0a",
    theme_color: "#0e0c0a",
    icons: [{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  };
}
