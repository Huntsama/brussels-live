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
  } catch (e) {
    console.error(e);
    // say so instead of freezing on old dots; the next poll tries again
    if (Date.now() - updated > 60000) document.getElementById('count').textContent = "STIB's live feed isn't answering, retrying…";
  }
}

// --- every frame: advance the estimate, then draw
let lastFrame = Date.now();
function frame() {
  const now = Date.now(), dt = Math.min(2, (now - lastFrame) / 1000);  // slow phones get fewer frames, not slower vehicles
  lastFrame = now;
  est.advance(now, dt);
  const shown = visibleVehicles();
  // metres per screen pixel at Brussels' latitude, for real-size vehicles and trails
  const mpp = 78271.517 * Math.cos(50.85 * Math.PI / 180) / 2 ** map.getZoom();
  overlay.setProps({ layers: [...baseLayers(), trailLayer(shown, mpp, now), pickedRing(), ...vehicleLayers(shown, mpp)] });
  if (picked) showPicked();
  showLine();
  requestAnimationFrame(frame);
}

const lineColor = id => rgb(net.lines[id].color);

// which vehicles to draw: the picked line only, "near me" only the ones still coming, otherwise the modes switched on
function visibleVehicles() {
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
  return shown;
}

// the network (or, near me, the roads onward): only changes when the selection does, so built once, not 60 times a second
let baseKey = '', base = [];
function baseLayers() {
  const key = `${line}|${!!nearPats}|${near?.length}|${onward.length}`;
  if (key === baseKey) return base;
  baseKey = key;
  const ours = onward.filter(o => !line || o.line === line);
  return base = [
    nearPats ? new deck.PathLayer({ id: 'onward', data: ours, getPath: o => o.path,
        widthUnits: 'pixels', getWidth: 4, getColor: o => [...lineColor(o.line), 170], capRounded: true, jointRounded: true })
    : new deck.PathLayer({ id: 'network', data: net.patterns, getPath: p => p.lonlat, widthUnits: 'pixels',
      getWidth: p => p.line === line ? 4 : 2, getColor: p => [...lineColor(p.line), line ? (p.line === line ? 85 : 15) : 45],
      updateTriggers: { getWidth: line, getColor: line } }),
    nearPats && new deck.TextLayer({ id: 'ends', data: ours, getPosition: o => o.path.at(-1),
      getText: o => `${o.line} → ${stopName(o.p.to)}`, characterSet: 'auto', getSize: 13, getColor: [15, 23, 42],
      background: true, getBackgroundColor: [255, 255, 255, 230], backgroundPadding: [4, 2], fontWeight: 600,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif' }),
    near && new deck.ScatterplotLayer({ id: 'near-stops', data: near.flatMap(g => g.ids), getPosition: id => [net.stops[id][1], net.stops[id][0]],
      getRadius: 6, radiusUnits: 'pixels', getFillColor: [255, 255, 255], getLineColor: [15, 23, 42], stroked: true, lineWidthMinPixels: 2 }),
  ];
}

// fading trails: the costly layer (a path per vehicle), rebuilt 4 times a second; ~30 px long so motion shows zoomed out
let trailsAt = 0, trails = null;
function trailLayer(shown, mpp, now) {
  if (now - trailsAt < 250) return trails;
  trailsAt = now;
  const len = Math.max(120, 30 * mpp);
  for (const v of shown) v.t = trail(v.p, v.shown - len, v.shown);
  return trails = new deck.TripsLayer({ id: 'trails', data: shown.slice(), getPath: v => v.t.path,
    getTimestamps: v => v.t.ts, getColor: v => lineColor(v.line), currentTime: 0, trailLength: len,
    widthMinPixels: 3, capRounded: true, jointRounded: true });
}

// a ring around the vehicle whose panel is open
function pickedRing() {
  const sel = vehicles.find(v => v.id === picked);
  return sel && modeOn[sel.mode] && new deck.ScatterplotLayer({ id: 'picked', data: [sel], getPosition: v => v.pos,
    getRadius: 60, radiusMinPixels: 22, stroked: true, filled: true, getFillColor: [15, 23, 42, 25],
    getLineColor: [15, 23, 42], lineWidthMinPixels: 2 });
}

// the vehicles, one layer per mode so each has its own size; metro drawn on top
function vehicleLayers(shown, mpp) {
  const bearing = map.getBearing(), boost = map.getZoom() >= 14 ? 1.5 : 1;  // bigger at street level, small on the city view
  return ['bus', 'tram', 'metro'].map(m => new deck.IconLayer({ id: m, data: shown.filter(v => v.mode === m), pickable: true,
    getIcon: v => ({ id: v.mode + v.line, url: vehicleSvg(v.mode, net.lines[v.line].color),
                     width: SHAPES[v.mode].w * 4, height: SHAPES[v.mode].h * 4 }),
    // real length in pixels at this zoom, but never smaller than minPx (deck's sizeMinPixels ignores flat icons)
    getPosition: v => v.pos, getAngle: v => v.angle + bearing, getSize: Math.max(SHAPES[m].minPx * boost, SHAPES[m].m / mpp),
    onClick: ({ object }) => pick(object.id) }));
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
