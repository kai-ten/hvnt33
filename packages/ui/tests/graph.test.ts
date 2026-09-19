import { describe, expect, it } from "vitest";
import { layout, mapSvg, type GraphEdge, type GraphNode } from "../src/lib/graph";

const nodes: GraphNode[] = ["a", "b", "c", "d", "e"].map(id => ({ id, title: `Record ${id.toUpperCase()} <&>`, kind: id === "a" ? "Person" : "Organization", status: "Unverified" }));
const edges: GraphEdge[] = [{ id: "1", fromId: "a", toId: "b", label: "owns", status: "Verified" }, { id: "2", fromId: "b", toId: "c", label: "paid", status: "Unverified" }];

describe("connection map", () => {
  it("lays out deterministically, inside the canvas, without overlaps", () => {
    const p1 = layout(nodes, edges, 1000, 600), p2 = layout(nodes, edges, 1000, 600);
    expect(p1).toEqual(p2);
    for (const { x, y } of Object.values(p1)) { expect(x).toBeGreaterThanOrEqual(40); expect(x).toBeLessThanOrEqual(960); expect(y).toBeGreaterThanOrEqual(30); expect(y).toBeLessThanOrEqual(570); }
    const ids = Object.keys(p1);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(Math.hypot(p1[ids[i]].x - p1[ids[j]].x, p1[ids[i]].y - p1[ids[j]].y)).toBeGreaterThan(40);
  });

  it("keeps dragged nodes where they were put, and connected records closer than unconnected ones", () => {
    const p = layout(nodes, edges, 1000, 600, { a: { x: 100, y: 100 } });
    expect(p.a).toEqual({ x: 100, y: 100 });
    const d = (x: string, y: string) => Math.hypot(p[x].x - p[y].x, p[x].y - p[y].y);
    expect(d("b", "c")).toBeLessThan(d("a", "e") + d("d", "e"));
  });

  it("exports an escaped, standalone SVG with dashed unverified connections", () => {
    const svg = mapSvg('Case "A" & B', nodes, edges, layout(nodes, edges, 1000, 600), 1000, 600);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain("Record A &lt;&amp;&gt;");
    expect(svg).not.toContain("<&>");
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(1);
    expect(svg).toContain("<title>Case &quot;A&quot; &amp; B</title>");
  });
});
