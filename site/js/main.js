// Startup: load the network, draw the line buttons, start polling. Loaded last.

document.getElementById('modes').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  modeOn[b.dataset.mode] = !modeOn[b.dataset.mode];
  b.setAttribute('aria-pressed', modeOn[b.dataset.mode]);
});
document.getElementById('lines').addEventListener('click', e => {
  const b = e.target.closest('[data-line]'); if (b) selectLine(b.dataset.line);
});

(async () => {
  net = await (await fetch('network.json')).json();
  est = Estimator.create(net);
  const num = s => s.replace(/\D/g, '') | 0;
  document.getElementById('lines').innerHTML = ['metro', 'tram', 'bus'].map(m => {
    const ids = Object.keys(net.lines).filter(id => net.lines[id].mode === m).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
    return `<div><p class="text-sm text-slate-500 mb-1.5 capitalize">${m}</p><div class="flex flex-wrap gap-1.5">${
      ids.map(id => `<button class="line" data-line="${id}" aria-pressed="false" title="${net.lines[id].name}">${badge(id)}</button>`).join('')}</div></div>`;
  }).join('');
  fetch(LAKE).then(r => r.json()).then(d => { lake = d.lines; }).catch(() => {});  // optional: the map works without it
  if (net.lines[location.hash.slice(1)]) map.once('load', () => selectLine(location.hash.slice(1)));
  await poll();
  setInterval(() => { if (!document.hidden) poll(); }, POLL);  // no data used while the phone is locked or in another app
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  requestAnimationFrame(frame);
})();
