import type { ReactNode } from "react";

export function PageHead({ title, children, running }: { title: string; children?: ReactNode; running?: ReactNode }) {
  return (
    <header className="pt-14 md:pt-20 pb-10">
      {running ? <p className="running-head mb-5">{running}</p> : null}
      <h1 className="display text-[clamp(1.85rem,1.2rem+3.4vw,4rem)]">{title}</h1>
      {children ? <div className="mt-6 text-[1.2rem] max-w-[58ch] leading-relaxed">{children}</div> : null}
    </header>
  );
}
