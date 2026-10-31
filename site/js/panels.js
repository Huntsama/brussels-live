// Everything written into the sidebar: names, badges, the vehicle panel and the line card.

const title = s => s.toLowerCase().replace(/(^|[\s\-'(])\S/g, c => c.toUpperCase());
function stopName(id) { return net.stops[id] ? title(net.stops[id][2]) : id; }
// STIB's directionId is sometimes a terminus id missing from StopDetails: fall back to the route's last stop
const destName = v => stopName(net.stops[v.dest] ? v.dest : v.p.to);

function badge(id) {
  const l = net.lines[id];
  return `<span class="inline-flex min-w-[2.25rem] justify-center rounded px-1.5 py-0.5 text-sm font-semibold" style="background:${l.color};color:${l.text}">${id}</span>`;
}

function usually(id) {
  const l = lake[id];
  if (!l) return '';
  const h = l.by_hour?.[new Date().getHours()] ?? l.excess;
  if (h == null) return '';
  const word = h < 0.5 ? 'usually on time' : `usually ${h.toFixed(1)} min late`;
  return `<p class="text-sm text-slate-600">At this hour line ${id} is ${word} <span class="text-slate-400">(Lakehouse)</span>.</p>`;
}

// plain words for what the vehicle is doing
function status(v, i) {
  if (v.speed > 0.5) return `Moving, about ${Math.round(v.speed * 3.6)} km/h`;
  if (v.shown - v.p.at[i] < 25) return `Stopped at ${stopName(v.p.stops[i])}`;
  return 'Waiting between stops';
}

function pick(id) { picked = id; showPicked(); }
function showPicked() {
  const v = vehicles.find(v => v.id === picked), el = document.getElementById('picked');
  if (!v) { el.classList.add('hidden'); picked = null; return; }
  const i = v.p.stops.findIndex((s, k) => v.p.at[k + 1] === undefined || v.p.at[k + 1] > v.shown);
  const last = v.p.stops[i], next = v.p.stops[i + 1];
  const html = `<div class="flex items-center gap-2">${badge(v.line)}<span class="font-medium">to ${destName(v)}</span>
      <button class="ml-auto text-slate-400 hover:text-slate-900" onclick="picked=null;document.getElementById('picked').classList.add('hidden')" aria-label="Close">✕</button></div>
    <p class="text-sm font-medium">${status(v, i)}</p>
    <p class="text-sm">${Math.round(v.shown - v.p.at[i])} m past <b>${stopName(last)}</b>${next ? `, next stop <b>${stopName(next)}</b> in ${Math.round(v.p.at[i + 1] - v.shown)} m` : ''}.</p>
    <p class="text-xs text-slate-500">STIB reported it ${Math.round((Date.now() - v.seen) / 1000)} s ago${v.shown - v.d > 5 ? `, ${Math.round(v.shown - v.d)} m behind where it is drawn` : ''}${v.guess ? ' · direction guessed' : ''}.</p>
    ${line === v.line ? '' : usually(v.line)}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.remove('hidden');
}

// the picked line: where it runs, how many are out right now, how late it usually is
function showLine() {
  const el = document.getElementById('lineinfo');
  if (!line || nearPats) { el.classList.add('hidden'); return; }
  const n = vehicles.filter(v => v.line === line).length;  // all of them, even if their mode is switched off
  const l = net.lines[line];
  const html = `<div class="flex items-center gap-2">${badge(line)}<span class="font-medium">${title(l.name).replace(' - ', ' ↔ ')}</span>
      <button class="ml-auto text-slate-400 hover:text-slate-900" onclick="selectLine(line)" aria-label="Show all lines">✕</button></div>
    <p class="text-sm">${n ? `${n} ${NOUN[l.mode][n === 1 ? 0 : 1]} running now` : 'No vehicle running right now'}</p>${usually(line)}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.remove('hidden');
}
