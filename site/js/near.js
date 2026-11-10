// "Near me": every stop within the chosen radius (else the nearest within 1 km), what leaves from them and where it goes

// radius the person picks (300 m / 500 m / 1 km), remembered on this device
let radius = 300;
try { radius = +localStorage.getItem('nearRadius') || 300; } catch (e) {}
let near = null, here = null, hereAcc = Infinity, usedAt = null, usedAcc = Infinity, nearPats = null, onward = [];
// one big button: find what's near me, and, once in that mode, the way back to the whole city
// geo.trigger() toggles MapLibre's control off again on a second press, so once we know where we are, skip it
document.getElementById('locate').addEventListener('click', () => near ? exitNear() : here ? findNear() : askWhere());
const say = msg => {
  document.getElementById('near').classList.remove('hidden');
  document.getElementById('near-list').innerHTML = `<p class="text-sm text-slate-500">${msg}</p>`;
};
// Before, a press showed nothing while the browser asked permission or looked for a fix, and a second press after
// an error switched MapLibre's control off instead of retrying. Now: say what's happening, and always (re)start it.
function askWhere() {
  say('Finding your location… If your browser asks, choose "Allow".');
  const s = geo._watchState;  // ponytail: MapLibre 4 internal; trigger() cycles OFF → on → OFF, so restart from OFF
  if (s && s !== 'OFF') geo.trigger();
  geo.trigger();
}
// The first fix is often a rough network guess; GPS comes seconds later. Redo "near me" when the position moved
// 100 m or got twice as precise, instead of keeping stops near the first guess.
geo.on('geolocate', e => {
  here = [e.coords.latitude, e.coords.longitude];
  hereAcc = e.coords.accuracy ?? Infinity;
  if (!usedAt) return findNear();
  if (near && (metres(usedAt, here) > 100 || hereAcc < usedAcc / 2)) findNear(metres(usedAt, here) > 100);  // don't move the map for a mere precision gain
});
// Once we have a position, a later error (phones time out the watch when they get no new fix in 15 s, e.g. standing
// still indoors) used to wipe the list. Keep the last position and the list instead.
geo.on('error', e => here || say(e.code === 1
  ? 'Location is blocked. Allow location for this site in your browser settings, then press the button again.'
  : "Couldn't get your location in time (no GPS signal?). Press the button to try again."));
// MapLibre's control zooms to street level on every fix, which left most of a 500 m or 1 km circle off-screen:
// we frame the radius ourselves instead.  ponytail: _updateCamera is MapLibre 4 internal, like _watchState above
geo._updateCamera = () => {};
function findNear(fit = true) {
  const entering = !near;
  if (fit) {
    const dLat = radius / 111320, dLon = dLat / Math.cos(here[0] * Math.PI / 180);
    map.fitBounds([[here[1] - dLon, here[0] - dLat], [here[1] + dLon, here[0] + dLat]], { padding: 30 });
  }
  usedAt = here; usedAcc = hereAcc;
  const byName = {};
  for (const [id, s] of Object.entries(net.stops)) {
    const d = metres(here, s);
    if (d > 1000) continue;
    const g = byName[s[2]] ??= { name: s[2], ids: [], d };
    g.ids.push(id); g.d = Math.min(g.d, d);
  }
  const all = Object.values(byName).sort((a, b) => a.d - b.d);
  // before: only the 2 closest stops, so a bus at a third stop next to you vanished from the map
  near = all.filter(g => g.d <= radius);
  if (!near.length) near = all.slice(0, 1);
  document.getElementById('near').classList.remove('hidden');
  document.getElementById('browse').classList.add('hidden');
  document.getElementById('locate').textContent = 'Show all of Brussels';
  if (!near.length) { document.getElementById('near-list').innerHTML = '<p class="text-sm text-slate-500">No STIB stop within 1 km.</p>'; return; }
  // each route through a nearby stop (not ending there): where on it the stop is, and the road onward
  const ids = new Set(near.flatMap(g => g.ids));
  nearPats = new Map();
  for (const p of net.patterns) {
    const i = p.stops.findIndex((s, k) => ids.has(s) && k < p.stops.length - 1);
    if (i >= 0) nearPats.set(p, i);
  }
  onward = [...nearPats].map(([p, i]) => ({ p, line: p.line, path: trail(p, p.at[i], p.cum.at(-1)).path }));
  if (entering) say('Found you. Loading what leaves from here…');  // replaces "Finding…" or an earlier timeout message
  if (line && entering) selectLine(line);  // clear the line on entry only; a GPS refresh used to toggle a tapped line off
  arrivals();
}
async function arrivals() {
  if (!near?.length) return;
  // ponytail: STIB returns at most 100 rows per call; stops are nearest-first, so only the farthest could go without times
  const ids = near.flatMap(g => g.ids.map(id => `"${net.stops[id][3]}"`)).join(',');
  try {
    const rows = (await (await fetch(`${WAIT}?where=pointid in (${ids})&limit=100`, { cache: 'no-store' })).json()).results;
    const now = Date.now();
    const rough = hereAcc > 150
      ? `<p class="text-xs text-amber-700">Your location is approximate (±${Math.round(hereAcc)} m); this list updates once it's more precise.</p>` : '';
    document.getElementById('near-list').innerHTML = rough + near.map(g => {
      const wanted = new Set(g.ids.map(id => net.stops[id][3]));
      const next = rows.filter(r => wanted.has(r.pointid)).flatMap(r => JSON.parse(r.passingtimes))
        .filter(t => t.expectedArrivalTime && t.destination?.fr && net.lines[t.lineId])  // STIB sometimes omits where it goes: skip those
        .map(t => ({ line: t.lineId, to: t.destination.fr, min: Math.max(0, Math.round((Date.parse(t.expectedArrivalTime) - now) / 60000)) }))
        .sort((a, b) => a.min - b.min);
      // one row per line and direction, with its next two arrivals
      const rowsHtml = Object.values(next.reduce((acc, t) => ((acc[t.line + t.to] ??= { ...t, mins: [] }).mins.push(t.min), acc), {}))
        .slice(0, 5).map(t => `<button class="w-full flex items-center gap-2 text-left text-sm py-1.5 border-t border-slate-100" data-line="${t.line}">${badge(t.line)}
            <span class="truncate">→ ${title(t.to)}</span>
            <span class="ml-auto shrink-0 text-right tabular-nums"><b>${t.mins[0] === 0 ? 'now' : t.mins[0] + ' min'}</b>${t.mins[1] !== undefined ? `<span class="text-slate-400"> · ${t.mins[1]}</span>` : ''}</span></button>`).join('');
      return `<div><p class="text-sm mb-1"><b>${title(g.name)}</b> <span class="text-slate-500">· ${Math.round(g.d / 10) * 10} m, ${Math.max(1, Math.round(g.d / WALK))} min walk</span></p>
        ${rowsHtml || '<p class="text-sm text-slate-500">Nothing announced right now.</p>'}</div>`;
    }).join('');
  } catch (e) { console.error(e); }
}
setInterval(arrivals, POLL);
function exitNear() {
  near = nearPats = null; onward = [];
  document.getElementById('near').classList.add('hidden');
  document.getElementById('browse').classList.remove('hidden');
  document.getElementById('locate').textContent = "Show what's near me";
  if (line) selectLine(line);
}
document.getElementById('all').addEventListener('click', exitNear);
document.getElementById('near-list').addEventListener('click', e => {
  const b = e.target.closest('[data-line]'); if (b) selectLine(b.dataset.line);  // tap again to see all nearby lines
});
document.getElementById('radius').value = radius;
document.getElementById('radius').addEventListener('change', e => {
  radius = +e.target.value;
  try { localStorage.setItem('nearRadius', radius); } catch (err) {}
  if (here) findNear();
});
