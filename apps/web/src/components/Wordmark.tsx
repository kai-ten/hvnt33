import Link from "next/link";

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="HVNT33, home">
      <span aria-hidden="true">HVNT33</span>
    </Link>
  );
}
