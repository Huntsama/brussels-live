// "Near me": the 2 closest stops (300 m, else the nearest within 1 km), what leaves from them and where it goes

let near = null, here = null, hereAcc = Infinity, usedAt = null, usedAcc = Infinity, nearPats = null, onward = [];
// one big button: find what's near me, and, once in that mode, the way back to the whole city
// geo.trigger() toggles MapLibre's control off again on a second press, so once we know where we are, skip it
document.getElementById('locate').addEventListener('click', () => near ? exitNear() : here ? findNear() : geo.trigger());
// The first fix is often a rough network guess; GPS comes seconds later. Redo "near me" when the position moved
// 100 m or got twice as precise, instead of keeping stops near the first guess.
geo.on('geolocate', e => {
  here = [e.coords.latitude, e.coords.longitude];
  hereAcc = e.coords.accuracy ?? Infinity;
  if (!usedAt) return findNear();
  if (near && (metres(usedAt, here) > 100 || hereAcc < usedAcc / 2)) findNear();
});
geo.on('error', () => {
  document.getElementById('near').classList.remove('hidden');
  document.getElementById('near-list').innerHTML =
    '<p class="text-sm text-slate-500">Location is blocked or unavailable. Allow location for this site in your browser settings, then press the button again.</p>';
});
function findNear() {
  usedAt = here; usedAcc = hereAcc;
  const byName = {};
  for (const [id, s] of Object.entries(net.stops)) {
    const d = metres(here, s);
    if (d > 1000) continue;
    const g = byName[s[2]] ??= { name: s[2], ids: [], d };
    g.ids.push(id); g.d = Math.min(g.d, d);
  }
  const all = Object.values(byName).sort((a, b) => a.d - b.d);
  near = all.filter(g => g.d <= 300).slice(0, 2);
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
  if (line) selectLine(line);
  arrivals();
}
async function arrivals() {
  if (!near?.length) return;
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
        .slice(0, 8).map(t => `<button class="w-full flex items-center gap-2 text-left text-sm py-1.5 border-t border-slate-100" data-line="${t.line}">${badge(t.line)}
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
