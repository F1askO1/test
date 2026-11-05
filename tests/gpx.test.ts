import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGpx } from "../backend/src/gpx.js";
import { analyze } from "../shared/track.js";
const point = (lat: string, time: string) =>
  `<trkpt lat="${lat}" lon="40"><ele>2000</ele><time>${time}</time></trkpt>`;
const a = point("43", "2026-01-01T10:00:00Z"),
  b = point("43.001", "2026-01-01T10:00:10+00:00");
const gpx = (body: string) =>
  Buffer.from(`<gpx version="1.1"><trk><trkseg>${body}</trkseg></trk></gpx>`);
test("valid GPX with namespaces, times and unknown vertical precision", () => {
  const p = parseGpx(gpx(a + b));
  assert.equal(p.length, 2);
  assert.equal(p[1].t - p[0].t, 10000);
  assert.equal(analyze(p).drop, null);
});
test("segment boundaries remain gaps", () => {
  const xml = `<gpx><trk><trkseg>${a}</trkseg><trkseg>${b}</trkseg></trk></gpx>`;
  const p = parseGpx(Buffer.from(xml));
  assert.equal(analyze(p).distance, 0);
});
test("reject DTD, invalid XML, wrong root, missing time, bad coordinates and oversized input", () => {
  for (const buffer of [
    Buffer.from('<!DOCTYPE x [<!ENTITY hi "x">]><gpx/>'),
    Buffer.from("<gpx>"),
    Buffer.from("<html/>"),
    gpx(a + point("400", "2026-01-01T10:00:10Z")),
    gpx(a + '<trkpt lat="43" lon="40"/>'),
    gpx(a + point("43", "2026-01-01T10:00:10")),
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ])
    assert.throws(() => parseGpx(buffer));
});
