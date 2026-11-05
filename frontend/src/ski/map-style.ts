import type { PolylineOptions } from "leaflet";
import { pisteColor, type SkiLine } from "../../../shared/ski";
// CSS pixel widths: independent of screen density. Geometry and difficulty remain untouched.
export function skiLineStyle(
  line: SkiLine,
  zoom: number,
  selected = false,
): PolylineOptions {
  const close = zoom >= 16,
    near = zoom >= 14;
  const weight =
    line.kind === "lift"
      ? close
        ? 1.3
        : near
          ? 1.05
          : 0.8
      : close
        ? 2.1
        : near
          ? 1.55
          : 1.05;
  return {
    color: line.kind === "lift" ? "#414951" : pisteColor(line.difficulty),
    weight: selected ? weight + 1.1 : weight,
    opacity: selected ? 1 : line.kind === "lift" ? 0.75 : 0.88,
    lineCap: "round",
    lineJoin: "round",
    smoothFactor: 0.8,
    dashArray:
      line.kind === "lift"
        ? close
          ? "4 5"
          : "3 5"
        : ["expert", "freeride", "extreme"].includes(line.difficulty ?? "")
          ? "3 4"
          : undefined,
  };
}
export function skiHaloStyle(
  line: SkiLine,
  zoom: number,
  selected = false,
): PolylineOptions | null {
  if (
    !selected &&
    (line.difficulty !== "advanced" || line.kind !== "piste" || zoom < 14)
  )
    return null;
  const style = skiLineStyle(line, zoom, selected);
  return {
    color: "#fff",
    weight: (style.weight ?? 1) + 1.4,
    opacity: selected ? 0.95 : 0.8,
    interactive: false,
    lineCap: "round",
    lineJoin: "round",
    smoothFactor: 0.8,
  };
}
export const showStations = (zoom: number) => zoom >= 15;
