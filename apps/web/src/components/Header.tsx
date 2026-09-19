import { Nav } from "./Nav";
import { Wordmark } from "./Wordmark";

export function Header() {
  return (
    <header className="site-header">
      <div className="wrap flex items-center justify-between gap-4 h-16">
        <Wordmark />
        <Nav />
      </div>
    </header>
  );
}
