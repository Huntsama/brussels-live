// Score the estimator offline: replay a recording (tools/record.js) and, at every new STIB reading,
// compare where the dot was with where the vehicle really was.
// node tools/replay.js recording.jsonl [site/network.json] [site/estimator.js]   (PARAMS='{"AHEAD":1}' to override constants)
const fs = require('fs');
const path = require('path');

const [rec, netFile = 'site/network.json', estFile = 'site/estimator.js'] = process.argv.slice(2);
const Estimator = require(path.resolve(estFile));
const net = JSON.parse(fs.readFileSync(netFile));
const frames = fs.readFileSync(rec, 'utf8').trim().split('\n').map(JSON.parse);
const est = Estimator.create(net, JSON.parse(process.env.PARAMS || '{}'));
const STEP = 0.25;  // seconds per animation step

const errs = [];
let now = frames[0].t, lineText = {};
est.update(frames[0].results, now);
for (const row of frames[0].results) lineText[row.lineid] = row.vehiclepositions;
for (const f of frames.slice(1)) {
  for (; now < f.t; now += STEP * 1000) est.advance(now, STEP);  // animate up to the moment of the new feed
  // only lines whose data STIB actually refreshed tell us where vehicles really were
  const refreshed = new Set(f.results.filter(row => lineText[row.lineid] !== row.vehiclepositions).map(row => row.lineid));
  for (const row of f.results) lineText[row.lineid] = row.vehiclepositions;
  const before = new Map(est.vehicles.map(v => [v.id, { shown: v.shown, raw: v.raw, speed: v.speed }]));
  for (const v of est.update(f.results, f.t)) {
    const b = before.get(v.id);
    if (b && refreshed.has(v.line)) errs.push({ err: b.shown - v.raw, mode: v.mode, departing: b.speed === 0 && v.raw > b.raw, still: b.raw === v.raw });
  }
}

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.floor(s.length * p)]); };
const stats = rows => {
  const e = rows.map(r => r.err);
  return { n: e.length, 'median abs (m)': q(e.map(Math.abs), .5), 'p90 abs (m)': q(e.map(Math.abs), .9),
           'bias (m)': Math.round(e.reduce((a, b) => a + b, 0) / e.length), 'behind %': Math.round(100 * e.filter(x => x < -50).length / e.length) };
};
if (process.env.JSON) { const a = stats(errs); console.log(JSON.stringify({ p50: a['median abs (m)'], p90: a['p90 abs (m)'], bias: a['bias (m)'], behind: a['behind %'] })); process.exit(); }
console.log(`${frames.length} feeds over ${Math.round((frames.at(-1).t - frames[0].t) / 1000)} s, ${errs.length} real readings`);
console.table({ all: stats(errs), 'vehicle moved': stats(errs.filter(r => !r.still)), 'vehicle still': stats(errs.filter(r => r.still)), departing: stats(errs.filter(r => r.departing)),
                metro: stats(errs.filter(r => r.mode === 'metro')), tram: stats(errs.filter(r => r.mode === 'tram')), bus: stats(errs.filter(r => r.mode === 'bus')) });
