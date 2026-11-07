import settings from "../../../map-sources/basemaps.json";
export type CleanTopography = {
  url: string;
  name: string;
  attribution: string;
  licenseUrl: string;
  termsUrl: string;
  maxNativeZoom: number;
  skiLines: "absent";
};
export function validateCleanTopography(
  value: unknown,
): CleanTopography | null {
  if (!value || typeof value !== "object") return null;
  const v = value as CleanTopography;
  try {
    const u = new URL(
      v.url
        .replaceAll("{z}", "1")
        .replaceAll("{x}", "1")
        .replaceAll("{y}", "1"),
    );
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !["{z}", "{x}", "{y}"].every((k) => v.url.includes(k))
    )
      return null;
    for (const link of [v.licenseUrl, v.termsUrl]) {
      const u = new URL(link);
      if (u.protocol !== "https:" || u.username || u.password) return null;
    }
    if (
      !v.name ||
      !v.attribution ||
      v.skiLines !== "absent" ||
      !Number.isInteger(v.maxNativeZoom) ||
      v.maxNativeZoom < 10 ||
      v.maxNativeZoom > 19
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
export const cleanTopography = validateCleanTopography(
  (settings as { cleanTopography: unknown }).cleanTopography,
);
export const escapeAttribution = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Published raster style confirms aerialways, but no piste rule was found.
// Deployment may differ: never infer baked piste colors solely from screenshots.
export function rasterSkiPolicy(
  topo: boolean,
  clean: boolean,
  avoidDouble: boolean,
  bakedPistes: boolean,
  zoom: number,
) {
  const active = topo && !clean && avoidDouble;
  return {
    pistes: active && bakedPistes,
    lifts: active && zoom >= 13,
    gondolas: active && zoom >= 12,
  };
}
