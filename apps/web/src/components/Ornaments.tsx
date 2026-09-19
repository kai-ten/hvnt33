// Small Roman ornaments, drawn inline so they take the theme's colors.

// A tessera cluster: the red corner square of the emblema, as a mark.
export function Tessera({ className = "" }: { className?: string }) {
  const tiles = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
  const jitter = [0.2, -0.3, 0.1, -0.1, 0.3, -0.2, 0.2, 0, -0.3];
  return (
    <svg viewBox="0 0 12 12" className={`tessera ${className}`} aria-hidden="true">
      {tiles.map(([x, y], i) => <rect key={i} x={x * 4 + 0.4 + jitter[i] * 0.3} y={y * 4 + 0.4 - jitter[i] * 0.3} width="3.2" height="3.2" transform={`rotate(${jitter[i] * 6} ${x * 4 + 2} ${y * 4 + 2})`} />)}
    </svg>
  );
}
