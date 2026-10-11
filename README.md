# Brussels Live

Every STIB metro, tram and bus in Brussels on one map, moving in real time, in STIB's own line colours. Plus what's arriving at the stops near you.

**Live:** https://huntsama.github.io/brussels-live/

![All vehicles](docs/map.jpg)

## The problem: STIB has no GPS feed

STIB's open data doesn't say where a vehicle *is*. Every ~20 seconds it says, per line:

```json
{"directionId": "8161", "pointId": "8012", "distanceFromPoint": 120}
```

"Heading to stop 8161, 120 metres past stop 8012". No coordinates, and no vehicle IDs.

## How it's turned into a moving dot

1. **Network (weekly, `build_network.py`)**
   - Joins three STIB sources:
     - the stops of each line in order (`StopsByLine`);
     - where each stop is (`StopDetails`);
     - the road each line drives on (`shapes.txt` from the GTFS timetable).
   - For each line and direction, it picks the timetable shape that best follows the stops.
   - It then measures how far along that road each stop is.
   - Output: `network.json` (about 250 KB gzipped). It covers 140 routes on 70 lines and 2,150 stops.
2. **Position:** a vehicle sits at `distance of last stop + metres since`, capped at the next stop, then placed on the road at that distance.
3. **Identity:** with no vehicle IDs, each new reading is matched to the previous reading just behind it on the same route.
4. **Movement:** STIB's feed changes about every 15–20 s. The page checks every 10 s, and only while it's on screen.
   - On a new reading, the vehicle slides there in 1.5 s.
   - It then keeps moving at its own measured speed (× 0.8, so it would rather lag than run ahead).
   - It stops at the next stop until STIB confirms it has passed, and it never moves backwards.
5. **Direction:** `directionId` is the terminus. A short-turning vehicle is matched to the route that contains both its stop and its terminus.

The page reads STIB's feed straight from the browser (it allows cross-origin requests, no key), so there is no backend.

## Near me

- **Your location:** "Show what's near me" uses the browser's Geolocation API through MapLibre's locate control (blue dot, accuracy circle, follow mode). It **stays on the device**: no server, nothing stored.
- **Nearby stops:** the 2 closest stops within 300 m (or the nearest one within 1 km), grouped by name, with walking time.
- **"Leaving from near you":** one row per line and direction (`71 → Delta  6 min · 15`), from STIB's own `WaitingTimes` predictions, refreshed every 20 s.
- **A calm map:** the rest of the city is hidden. You see only:
  - the road each of those lines takes onward from your stop, labelled with where it ends;
  - the vehicles still coming towards you.
- **Tap a row** to keep only that line. "Show all of Brussels" brings the full map back.
- **Install as an app:** a web app manifest lets you add it to your phone's home screen, where it opens full screen like an app.

![Near me](docs/near.jpg)

## Drawing

- **MapLibre GL JS** draws the base map (OpenFreeMap vector tiles, no key needed).
- **deck.gl** draws on the GPU:
  - each vehicle as a top-down metro (4 cars), tram (3 sections) or bus in its line colour, turned to face along the road;
  - a fading trail behind each vehicle (`TripsLayer`);
  - the whole network as faint lines.
- **Sizes:** zoomed in, vehicles are drawn at roughly real length (metro 92 m, tram 44 m, bus 18 m). Zoomed out, they keep a minimum size so they stay visible.
- **Tilt:** right-drag (or two fingers) tilts the map.

![Close up, tilted, one tram picked](docs/line.jpg)

## Fed by Brussels Lakehouse

[Brussels Lakehouse](https://github.com/Huntsama/brussels-lakehouse) has recorded STIB every 5 minutes since October. It publishes `lines.json`, which gives each line's typical lateness by hour of day. Click a vehicle and the panel shows, for example, *"At this hour line 71 is usually 0.6 min late"*. The lakehouse answers how late lines usually are; this map shows where the vehicles are now.

## Run locally

```bash
python3 build_network.py site/network.json   # stdlib only, ~10 s
cd site && python3 -m http.server
```

## Limits

- Positions are estimates. They're exact at stops and linear in between.
- About 12 routes currently run on roadworks diversions that the timetable shape doesn't match. Those are drawn as straight lines between stops.
- `M6`, `T39` and `T81` are replacement buses for metro 6 and trams 39 and 81, so they're shown as buses.

Developed by [Jawad Shaissah](https://www.jwds.me). Data: STIB-MIVB open data. Map © OpenStreetMap contributors.
