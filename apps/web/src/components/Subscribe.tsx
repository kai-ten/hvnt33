"use client";
import { useState, type FormEvent } from "react";
import { Tessera } from "./Ornaments";

// The newsletter form. It posts to /api/newsletter, which sends a confirmation
// email; nobody is subscribed until they click the link in it. Without
// JavaScript the form still works and lands on the check-your-email page.
export function Subscribe({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("sending");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: form.get("email"), website: form.get("website") }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That didn't go through. Try again.");
      setState("sent");
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  };

  return (
    <section className={`subscribe ${compact ? "compact" : ""}`} aria-labelledby="subscribe-title">
      <h2 id="subscribe-title" className="caps text-[1.05rem] flex items-center"><Tessera />Get the next investigation</h2>
      {state === "sent" ? (
        <p className="mt-3" role="status">Check your inbox. Click the link in the email we just sent, and you&rsquo;re subscribed.</p>
      ) : (
        <>
          <p className="mt-3 dim">By email, when it&rsquo;s published. Unsubscribe from any email with one click.</p>
          <form action="/api/newsletter" method="post" onSubmit={submit} className="mt-5 flex flex-wrap gap-3">
            <label htmlFor={compact ? "sub-email-c" : "sub-email"} className="sr-only">Email address</label>
            <input id={compact ? "sub-email-c" : "sub-email"} name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="field" />
            <input name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="trap" />
            <button type="submit" className="btn btn-primary" disabled={state === "sending"}>{state === "sending" ? "Sending" : "Subscribe"}</button>
          </form>
          {state === "error" ? <p className="mt-3 text-rubric" role="alert">{message}</p> : null}
        </>
      )}
    </section>
  );
}
