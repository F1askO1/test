import type { Coord, SkiLine } from "./ski.js";
export type SkiArea = {
  id: string;
  name: string;
  difficulty: string | null;
  grooming?: string;
  rings: Coord[][];
  sources: string[];
  complete: boolean;
};
// Assemble only rings connected by EXACT source endpoints. No snapping, inferred
// centerlines or closing an incomplete chain with an invented segment.
export function assembleRings(parts: Coord[][]) {
  const pending = parts.map((cs) => [...cs]),
    rings: Coord[][] = [];
  let incomplete = 0;
  const equal = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
  while (pending.length) {
    let chain = pending.shift()!;
    while (!equal(chain[0], chain.at(-1)!)) {
      const i = pending.findIndex(
        (p) => equal(p[0], chain.at(-1)!) || equal(p.at(-1)!, chain.at(-1)!),
      );
      if (i < 0) break;
      let next = pending.splice(i, 1)[0];
      if (!equal(next[0], chain.at(-1)!)) next.reverse();
      chain.push(...next.slice(1));
    }
    if (chain.length >= 4 && equal(chain[0], chain.at(-1)!)) rings.push(chain);
    else incomplete++;
  }
  return { rings, incomplete };
}
export const areaBoundary = (l: SkiLine) => l.geometryRole === "area-boundary";
export function containsArea(p: { lon: number; lat: number }, area: SkiArea) {
  if (!area.complete) return false;
  let inside = false;
  for (const cs of area.rings)
    for (let j = 0, k = cs.length - 1; j < cs.length; k = j++) {
      const a = cs[j],
        b = cs[k];
      if (
        a[1] > p.lat !== b[1] > p.lat &&
        p.lon < ((b[0] - a[0]) * (p.lat - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
  return inside;
}
