// Where is each STIB vehicle right now? Shared by the page and by tools/replay.js, which scores it offline.
//
// STIB says, per line: "heading to stop D, N metres past stop P", with no vehicle ids. The feed changes every
// ~15 s but each line's data only refreshes every ~30 s (measured with tools/record.js): a repeated reading is
// no news, not a stopped vehicle. Everything here works in metres along a route pattern (a line's stops in
// order plus the road between them). Constants were tuned with tools/replay.js on recorded feeds.
const Estimator = (() => {
  const DEFAULTS = {
    MAX_SPEED: { metro: 22, tram: 15, bus: 14 },  // m/s (~80, 55, 50 km/h): a dot never moves faster
    SCHED: 1.2,        // expected moving speed = SCHED x the timetable's average speed on that segment
    AHEAD: 0.9,        // predict with this share of the vehicle's speed: rather a bit behind than ahead
    CLOSE: 2,          // seconds to close a gap between the dot and where the vehicle should be
    MAX_AHEAD: 400,    // never predict more than this many metres past the last reading
    STALE: 180,        // s without a refresh of a line's data: assume the line stopped running
  };

  const norm = id => id.replace(/[A-Z]$/, '').replace(/^0+/, '');

  // --- geometry: metres along a pattern's path <-> [lon, lat]
  function metres(a, b) {
    const x = (b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360);
    return Math.hypot(x, b[0] - a[0]) * 111320;
  }
  function prep(net) {
    net.byLine = {};
    for (const p of net.patterns) {
      p.cum = [0];
      for (let i = 1; i < p.path.length; i++) p.cum.push(p.cum[i - 1] + metres(p.path[i - 1], p.path[i]));
      p.lonlat = p.path.map(([la, lo]) => [lo, la]);
      (net.byLine[p.line] ??= []).push(p);
    }
    return net;
  }
  function seg(p, d) {
    const c = p.cum; let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    return [lo, hi];
  }
  function pointAt(p, d) {
    d = Math.max(0, Math.min(d, p.cum[p.cum.length - 1]));
    const [lo, hi] = seg(p, d), c = p.cum, t = c[hi] === c[lo] ? 0 : (d - c[lo]) / (c[hi] - c[lo]);
    const a = p.lonlat[lo], b = p.lonlat[hi];
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }

  // --- which pattern a reading belongs to: the one ending at its destination (by id, else by the terminus name:
  // the other platform of the same terminus), else one that has the stop. ~10% of readings head for a 99xx code,
  // a temporary terminus of a line on works that no stop dataset knows: those fall back to the first candidate
  function locate(net, lineId, r) {
    const stop = norm(r.pointId), dest = norm(r.directionId), name = id => net.stops[id]?.[2];
    const cands = (net.byLine[lineId] || []).filter(p => p.stops.includes(stop));
    let p = cands.find(p => p.to === dest)
         || (name(dest) && cands.find(p => name(p.to) === name(dest)))
         || cands.find(p => p.stops.indexOf(dest) > p.stops.indexOf(stop));
    const guess = !p && new Set(cands.map(p => p.to)).size > 1;  // more than one way to go and no way to tell
    p ||= cands[0];
    if (!p) return null;
    const i = p.stops.indexOf(stop);
    const cap = p.at[i + 1] ?? p.at[i];  // a vehicle can't be past its next stop until STIB says so
    return { line: lineId, mode: net.lines[lineId].mode, dest, p, i, cap, guess, d: Math.min(p.at[i] + r.distanceFromPoint, cap) };
  }

  function create(net, overrides = {}) {
    const { MAX_SPEED, SCHED, AHEAD, CLOSE, MAX_AHEAD, STALE } = { ...DEFAULTS, ...overrides };
    prep(net);
    let vehicles = [], nextId = 1;
    const lineText = {}, lineSeen = {};  // per line: STIB's last positions string and when it last changed
    // the timetable's average speed on the segment the vehicle is on (includes the stop's dwell)
    const sched = v => ((v.p.at[v.i + 1] ?? v.p.at[v.i]) - v.p.at[v.i]) / (v.p.secs[v.i] ?? 60);

    // STIB gives no vehicle ids: match each new reading to the old one just behind it on the same pattern
    function match(old, fresh, now) {
      const pool = old.slice();
      for (const v of fresh) {
        let best = -1, gap = Infinity;
        pool.forEach((o, k) => {
          if (o.p !== v.p) return;
          const g = v.d - o.raw;
          if (g > -30 && g < 1500 && Math.abs(g) < gap) { gap = Math.abs(g); best = k; }
        });
        if (best >= 0) {
          const o = pool.splice(best, 1)[0], secs = (now - o.seen) / 1000;
          v.id = o.id;
          v.shown = v.d;  // STIB just said where it is: draw it there (median error 15 m vs 37 m when gliding on)
          // speed from STIB's last two readings, smoothed; 0 when it hasn't moved (waiting at a stop)
          const sp = secs > 1 ? Math.min(25, Math.max(0, (v.d - o.raw) / secs)) : o.speed;
          v.speed = v.d === o.raw ? 0 : (o.speed ? (o.speed + sp) / 2 : sp);
          v.raw = v.d;
        }
        // new vehicle: standing at a stop (0 m past it) waits, otherwise it moves at the timetable's speed straight away
        else { v.shown = v.raw = v.d; v.id = nextId++; v.speed = v.d === v.p.at[v.i] ? 0 : SCHED * sched(v); }
        v.seen = now;
      }
    }

    return {
      net,
      get vehicles() { return vehicles; },
      // a new feed: `results` as STIB sends them
      update(results, now = Date.now()) {
        const fresh = [], stale = new Set();
        for (const row of results) {
          if (!net.lines[row.lineid]) continue;
          if (lineText[row.lineid] === row.vehiclepositions) { stale.add(row.lineid); continue; }  // not refreshed: no news
          lineText[row.lineid] = row.vehiclepositions;
          lineSeen[row.lineid] = now;
          for (const r of JSON.parse(row.vehiclepositions)) {
            const v = locate(net, row.lineid, r);
            if (v) fresh.push(v);
          }
        }
        // vehicles on lines without news keep predicting from their last real reading
        const carried = vehicles.filter(v => stale.has(v.line) && now - lineSeen[v.line] < STALE * 1000);
        match(vehicles.filter(v => !stale.has(v.line)), fresh, now);
        return (vehicles = fresh.concat(carried));
      },
      // one animation step of `dt` seconds: move each dot towards where the vehicle should be now
      advance(now = Date.now(), dt) {
        for (const v of vehicles) {
          // target: last reading + its own speed since, not past the next stop
          const target = Math.min(v.cap, v.d + MAX_AHEAD, v.d + AHEAD * v.speed * (now - v.seen) / 1000);
          const gap = target - v.shown;
          // close a gap over CLOSE s, never faster than a real vehicle; never backwards (it waits for the reading instead)
          if (gap > 0) v.shown += Math.min(gap, dt * Math.min(MAX_SPEED[v.mode], Math.max(AHEAD * v.speed, gap / CLOSE)));
        }
      },
    };
  }

  return { create, norm, metres, seg, pointAt, DEFAULTS };
})();
if (typeof module !== 'undefined') module.exports = Estimator;
