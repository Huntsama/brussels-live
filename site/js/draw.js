// Geometry and vehicle pictures: pure helpers, no page state.

const { norm, metres, seg, pointAt } = Estimator;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// a vehicle seen from above, front pointing up, as an SVG data URL; built once per mode and colour, then reused
const svgCache = {};
function vehicleSvg(mode, color) {
  return svgCache[mode + color] ??= drawVehicle(mode, color);
}
function drawVehicle(mode, color) {
  const s = SHAPES[mode], gap = 1.5, car = (s.h - gap * (s.cars - 1)) / s.cars;
  let g = '';
  for (let i = 0; i < s.cars; i++) {
    const y = i * (car + gap), first = i === 0, last = i === s.cars - 1;
    const r = `x="1" y="${y + .5}" width="${s.w - 2}" height="${car - 1}" rx="${first || last ? 4 : 1.5}"`;
    // white halo first, so a vehicle never melts into its own line colour underneath
    g += `<rect ${r} fill="none" stroke="#fff" stroke-width="2"/><rect ${r} fill="${color}" stroke="#0f172a" stroke-opacity=".6" stroke-width=".8"/>`;
  }
  g += `<rect x="2.6" y="2.2" width="${s.w - 5.2}" height="3" rx="1.2" fill="#fff" opacity=".9"/>`;  // windscreen = front
  return `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w * 4}" height="${s.h * 4}" viewBox="0 0 ${s.w} ${s.h}">${g}</svg>`);
}

// heading in deck.gl terms: degrees counter-clockwise from north
function angleAt(p, d) {
  const a = pointAt(p, d - 8), b = pointAt(p, d + 8);
  const dx = (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), dy = b[1] - a[1];
  return -Math.atan2(dx, dy) * 180 / Math.PI;
}
// the road between two distances, with "time" = metres behind the vehicle, for the fading trail
function trail(p, from, to) {
  from = Math.max(0, from);
  const [i] = seg(p, from), [, j] = seg(p, to), path = [pointAt(p, from)], ts = [from - to];
  for (let k = i + 1; k < j; k++) { path.push(p.lonlat[k]); ts.push(p.cum[k] - to); }
  path.push(pointAt(p, to)); ts.push(0);
  return { path, ts };
}
