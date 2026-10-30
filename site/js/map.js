// The map, the live feed and the animation loop.

const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: [4.36, 50.845], zoom: 12.6, attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
// blue dot, accuracy circle and follow mode come with MapLibre; the browser asks permission
const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true,
  fitBoundsOptions: { maxZoom: 16 } });
map.addControl(geo, 'top-right');
const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [],
  getTooltip: ({ object }) => object?.marker && `${object.line} → ${destName(object)}` });
map.addControl(overlay);

// page state
let lastFeed = '', net, est, lake = {}, vehicles = [], updated = 0, line = null, picked = null;
const modeOn = { metro: true, tram: true, bus: true };

// --- live feed: STIB's vehicle positions, read straight from the browser
async function poll() {
  try {
    const text = await (await fetch(FEED, { cache: 'no-store' })).text();
    if (text === lastFeed) return;  // same reading as last time: keep predicting, don't reset speeds
    lastFeed = text;
    vehicles = est.update(JSON.parse(text).results);
    updated = Date.now();
    const n = { metro: 0, tram: 0, bus: 0 };
    vehicles.forEach(v => n[v.mode]++);
    for (const m in n) document.querySelector(`[data-n="${m}"]`).textContent = n[m];
    document.getElementById('count').textContent = `${vehicles.length} vehicles moving`;
  } catch (e) { console.error(e); }
}

// --- every frame: advance the estimate, then draw
let lastFrame = Date.now(), staticKey = '', staticLayers = [], trailsAt = 0, trailsLayer = null;
function frame() {
  const now = Date.now(), dt = Math.min(2, (now - lastFrame) / 1000);  // slow phones get fewer frames, not slower vehicles
  lastFrame = now;
  est.advance(now, dt);
  const shown = [];
  for (const v of vehicles) {
    if (line && v.line !== line) continue;
    if (nearPats) {  // near me: only vehicles still coming towards a nearby stop, at most 3 km away
      const i = nearPats.get(v.p);
      if (i === undefined || v.shown > v.p.at[i] + 20 || v.shown < v.p.at[i] - 3000) continue;
    } else if (!modeOn[v.mode]) continue;
    v.pos = pointAt(v.p, v.shown);
    v.angle = angleAt(v.p, v.shown);
    v.marker = true;
    shown.push(v);
  }
  const sel = vehicles.find(v => v.id === picked);
  const mpp = 78271.517 * Math.cos(50.85 * Math.PI / 180) / 2 ** map.getZoom(), bearing = map.getBearing();
  const color = id => rgb(net.lines[id].color);
  // the map itself only changes when the selection does: build those layers once, not 60 times a second
  const key = `${line}|${!!nearPats}|${near?.length}|${onward.length}`;
  if (key !== staticKey) { staticKey = key; staticLayers = [
    nearPats ? new deck.PathLayer({ id: 'onward', data: onward.filter(o => !line || o.line === line), getPath: o => o.path,
        widthUnits: 'pixels', getWidth: 4, getColor: o => [...color(o.line), 170], capRounded: true, jointRounded: true })
    : new deck.PathLayer({ id: 'network', data: net.patterns, getPath: p => p.lonlat, widthUnits: 'pixels',
      getWidth: p => p.line === line ? 4 : 2, getColor: p => [...color(p.line), line ? (p.line === line ? 85 : 15) : 45],
      updateTriggers: { getWidth: line, getColor: line } }),
    nearPats && new deck.TextLayer({ id: 'ends', data: onward.filter(o => !line || o.line === line), getPosition: o => o.path.at(-1),
      getText: o => `${o.line} → ${stopName(o.p.to)}`, characterSet: 'auto', getSize: 13, getColor: [15, 23, 42],
      background: true, getBackgroundColor: [255, 255, 255, 230], backgroundPadding: [4, 2], fontWeight: 600,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif' }),
    near && new deck.ScatterplotLayer({ id: 'near-stops', data: near.flatMap(g => g.ids), getPosition: id => [net.stops[id][1], net.stops[id][0]],
      getRadius: 6, radiusUnits: 'pixels', getFillColor: [255, 255, 255], getLineColor: [15, 23, 42], stroked: true, lineWidthMinPixels: 2 }),
  ]; }
  // trails: the costly layer (a path per vehicle), rebuilt 4 times a second; as long as ~30 px so motion shows when zoomed out
  if (now - trailsAt > 250) {
    trailsAt = now;
    const len = Math.max(120, 30 * mpp);
    for (const v of shown) v.t = trail(v.p, v.shown - len, v.shown);
    trailsLayer = new deck.TripsLayer({ id: 'trails', data: shown.slice(), getPath: v => v.t.path,
      getTimestamps: v => v.t.ts, getColor: v => color(v.line), currentTime: 0, trailLength: len,
      widthMinPixels: 3, capRounded: true, jointRounded: true });
  }
  overlay.setProps({ layers: [
    ...staticLayers,
    trailsLayer,
    sel && modeOn[sel.mode] && new deck.ScatterplotLayer({ id: 'picked', data: [sel], getPosition: v => v.pos,
      getRadius: 60, radiusMinPixels: 22, stroked: true, filled: true, getFillColor: [15, 23, 42, 25],
      getLineColor: [15, 23, 42], lineWidthMinPixels: 2 }),
    // one layer per mode so each has its own size; metro drawn on top
    ...['bus', 'tram', 'metro'].map(m => new deck.IconLayer({ id: m, data: shown.filter(v => v.mode === m), pickable: true,
      getIcon: v => ({ id: v.mode + v.line, url: vehicleSvg(v.mode, net.lines[v.line].color),
                       width: SHAPES[v.mode].w * 4, height: SHAPES[v.mode].h * 4 }),
      // real length in pixels at this zoom, but never smaller than minPx (deck's sizeMinPixels ignores flat icons)
      getPosition: v => v.pos, getAngle: v => v.angle + bearing, getSize: Math.max(SHAPES[m].minPx * (map.getZoom() >= 14 ? 1.5 : 1), SHAPES[m].m / mpp),  // bigger at street level, small on the city view
      onClick: ({ object }) => pick(object.id) })),
  ]});
  if (picked) showPicked();
  showLine(shown.length);
  requestAnimationFrame(frame);
}
setInterval(() => {
  if (updated) document.getElementById('ago').textContent = `· updated ${Math.round((Date.now() - updated) / 1000)}s ago`;
}, 1000);

// pick a line: highlight it, keep it in the URL, zoom to it
function selectLine(id) {
  line = line === id ? null : id;
  document.querySelectorAll('.line').forEach(b => b.setAttribute('aria-pressed', b.dataset.line === line));
  history.replaceState(null, '', line ? '#' + line : location.pathname);
  if (!line || nearPats) return;
  const pts = net.byLine[line].flatMap(p => p.lonlat);
  const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40 });
}
