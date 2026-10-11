// node --test tools/   (the smallest checks that fail if the estimator's rules break)
const test = require('node:test');
const assert = require('node:assert');
const Estimator = require('../site/estimator.js');

// one bus line, three stops in a straight line 500 m apart, timetable 60 s per segment
const net = () => Estimator.create({
  lines: { 1: { mode: 'bus' } },
  stops: {},
  patterns: [{ line: '1', to: '30', stops: ['10', '20', '30'], at: [0, 500, 1000], secs: [60, 60],
               path: [[50.8, 4.3], [50.8, 4.30709], [50.8, 4.31418]] }],
});
const feed = (...vehicles) => [{ lineid: '1', vehiclepositions: JSON.stringify(vehicles) }];
const bus = (pointId, distanceFromPoint) => ({ directionId: '30', pointId, distanceFromPoint });

test('a repeated line reading is no news: the vehicle keeps its speed and position', () => {
  const est = net();
  est.update(feed(bus('10', 100)), 0);
  const [a] = est.update(feed(bus('10', 250)), 30000);   // moved 150 m in 30 s
  const [v] = est.update(feed(bus('10', 250)), 45000);   // same string: STIB did not refresh this line
  assert.ok(a.speed > 0);
  assert.equal(v.speed, a.speed);
  assert.equal(v.seen, 30000);
});

test('a refreshed line with an unchanged vehicle means it really stopped', () => {
  const est = net();
  est.update(feed(bus('10', 100), bus('20', 0)), 0);
  const [v] = est.update(feed(bus('10', 100), bus('20', 20)), 30000);  // string changed, this vehicle did not move
  assert.equal(v.speed, 0);
});

test('a dot moves forward at the vehicle speed, never backwards and never past the next stop', () => {
  const est = net();
  est.update(feed(bus('10', 100)), 0);
  est.update(feed(bus('10', 400)), 30000);  // 10 m/s
  for (let t = 30000; t < 60000; t += 250) est.advance(t, 0.25);
  const [v] = est.vehicles;
  assert.ok(v.shown > 400 && v.shown <= 500, `shown ${v.shown}`);
  est.update(feed(bus('10', 400)), 60000);
  for (let t = 60000; t < 70000; t += 250) est.advance(t, 0.25);
  assert.ok(est.vehicles[0].shown >= v.shown);
});
