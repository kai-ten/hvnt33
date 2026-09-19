// Re-mounted on every navigation, so each page enters with its own transition.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
