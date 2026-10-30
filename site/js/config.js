// Brussels Live: settings shared by every other script. Loaded first.

// --- live data
const POLL = 10000;       // STIB's feed changes every ~15-20 s; 10 s catches each change soon after
const FEED = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/rt/VehiclePositions';
const LAKE = 'https://lakehouse.jwds.me/lines.json';
const WAIT = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/rt/WaitingTimes';
const WALK = 80;  // metres per minute, for "N min walk"

// --- vehicles seen from above, front pointing up. Real lengths in metres; never smaller than minPx on screen.
const SHAPES = {
  metro: { w: 12, h: 92, m: 92, minPx: 28, cars: 4 },
  tram:  { w: 11, h: 44, m: 44, minPx: 22, cars: 3 },
  bus:   { w: 11, h: 22, m: 18, minPx: 18, cars: 1 },
};

// what to call N vehicles of a mode in the line card
const NOUN = { metro: ['metro train', 'metro trains'], tram: ['tram', 'trams'], bus: ['bus', 'buses'] };
