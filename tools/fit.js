// What speed should we expect over the next ~17 s? Pull (state -> what happened) rows out of a recording,
// to fit the speed model in estimator.js. node tools/fit.js recording.jsonl > rows.json
const fs = require('fs');
const Estimator = require('../site/estimator.js');
const [rec, netFile = 'site/network.json'] = process.argv.slice(2);
const net = JSON.parse(fs.readFileSync(netFile));
const frames = fs.readFileSync(rec, 'utf8').trim().split('\n').map(JSON.parse);
const est = Estimator.create(net);
const last = new Map();  // id -> { raw, t, moved (time the position last changed), speed }
const rows = [];
for (const f of frames) {
  for (const v of est.update(f.results, f.t)) {
    if (v.seen !== f.t) continue;  // line not refreshed: nothing new about this vehicle
    const o = last.get(v.id), p = v.p, i = v.i;
    const segLen = (p.at[i + 1] ?? p.at[i]) - p.at[i], sched = segLen / (p.secs[i] ?? 60);
    if (o && f.t > o.t) {
      rows.push({ mode: v.mode, dt: (f.t - o.t) / 1000, dd: v.raw - o.raw, speed: o.speed, sched: o.sched,
                  stopped: (o.t - o.moved) / 1000, toNext: o.toNext, atStop: o.atStop, end: o.end });
    }
    last.set(v.id, { raw: v.raw, t: f.t, moved: o && v.raw === o.raw ? o.moved : f.t, speed: v.speed, sched,
                     toNext: v.cap - v.raw, atStop: v.raw === p.at[i], end: i === 0 || i >= p.stops.length - 1 });
  }
}
console.log(JSON.stringify(rows));
