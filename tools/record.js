// Record STIB's live feed for a while: one line of JSON per change, with the time it was seen.
// node tools/record.js 300 > recording.jsonl
const FEED = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/rt/VehiclePositions';
const secs = +process.argv[2] || 300, end = Date.now() + secs * 1000;
let last = '';
(async () => {
  while (Date.now() < end) {
    try {
      const text = await (await fetch(FEED)).text();
      if (text !== last) { last = text; console.log(JSON.stringify({ t: Date.now(), results: JSON.parse(text).results })); }
    } catch (e) { console.error(e.message); }
    await new Promise(r => setTimeout(r, 5000));
  }
})();
