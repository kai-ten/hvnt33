// Rendered at build time from the repository's own Markdown (src/lib/markdown.ts).
export const Prose = ({ html, className = "" }: { html: string; className?: string }) => (
  <div className={`prose ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
);
