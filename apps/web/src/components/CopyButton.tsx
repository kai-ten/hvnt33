"use client";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "./Icons";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { /* clipboard refused: the text is still selectable */ }
  };
  return (
    <button type="button" className="icon-btn copy" onClick={copy} aria-label={done ? "Copied" : label}>
      {done ? <CheckIcon /> : <CopyIcon />}
      <span className="sr-only" aria-live="polite">{done ? "Copied" : ""}</span>
    </button>
  );
}
