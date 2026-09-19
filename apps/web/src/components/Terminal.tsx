import { CopyButton } from "./CopyButton";

export interface Line { command: string; note?: string }

// Commands as a reader would type them. The copy button copies only the
// commands: no prompt, no comments.
export function Terminal({ lines, label }: { lines: Line[]; label: string }) {
  return (
    <div className="term">
      <pre aria-label={label} tabIndex={0}><code>{lines.map((l, i) => (
        <span key={i} className="block">
          <span className="prompt" aria-hidden="true">$ </span>{l.command}
          {l.note ? <span className="comment">{"  "}# {l.note}</span> : null}
        </span>
      ))}</code></pre>
      <CopyButton text={lines.map(l => l.command).join("\n")} label={`Copy: ${label}`} />
    </div>
  );
}
