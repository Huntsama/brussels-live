"""Build network.json: every STIB line, its stops in order, and the road it drives on.

STIB's live feed has no GPS. It says "line 71, heading to stop D, 120 m past stop P".
To draw that, the page needs each line's stops in order (STIB StopsByLine), where the
stops are (StopDetails) and the road between them (GTFS shapes.txt). This joins them.
Runs weekly in CI; the timetable changes a few times a year.
"""

import csv
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict

API = "https://api-management-discovery-production.azure-api.net/api"
STIB = f"{API}/datasets/stibmivb/static"
MODES = {"0": "tram", "1": "metro", "3": "bus"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "brussels-live"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def pages(name, size=1000):
    out, offset = [], 0
    while True:
        rows = json.loads(get(f"{STIB}/{name}?limit={size}&offset={offset}"), strict=False)["results"]
        out += rows
        if len(rows) < size:
            return out
        offset += size


def norm(stop_id):
    # "0473F" in one dataset is "473" in another: drop the platform letter and leading zeros
    return re.sub(r"[A-Z]$", "", stop_id).lstrip("0")


def metres(a, b):
    # equirectangular is plenty at city scale
    x = (b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(x, b[0] - a[0]) * 111_320


def project(p, a, b):
    """Fraction t along segment a-b closest to p, and the distance to it."""
    k = math.cos(math.radians(a[0]))
    ax, ay, bx, by, px, py = a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return t, metres(p, (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))


def along(path, stops):
    """Distance along `path` of each stop, never going backwards."""
    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + metres(a, b))
    out, start = [], 0
    for s in stops:
        best = min(((project(s, path[i], path[i + 1]), i) for i in range(start, len(path) - 1)),
                   key=lambda x: x[0][1], default=((0.0, 0.0), start))
        (t, _), i = best
        d = round(cum[i] + t * (cum[i + 1] - cum[i]) if i + 1 < len(cum) else cum[i])
        out.append(max(d, out[-1] if out else 0))
        start = i
    return out


def fit(path, stops):
    """Mean distance (m) from a few stops to the nearest shape point: lower = better match."""
    sample = stops[:: max(1, len(stops) // 8)] + [stops[-1]]
    return sum(min(metres(s, p) for p in path[::3]) for s in sample) / len(sample)


def thin(path, step=12):
    out = [path[0]]
    for p in path[1:-1]:
        if metres(out[-1], p) >= step:
            out.append(p)
    return out + [path[-1]]


def build():
    stops = {}
    for r in pages("StopDetails"):
        gps = json.loads(r["gpscoordinates"])
        name = json.loads(r["name"])
        # 4th field: the id the WaitingTimes feed uses (leading zeros kept, platform letter dropped)
        stops[norm(r["id"])] = [round(gps["latitude"], 6), round(gps["longitude"], 6), name.get("fr") or name.get("nl"),
                                re.sub(r"[A-Z]$", "", r["id"])]

    z = zipfile.ZipFile(io.BytesIO(get(f"{API}/gtfs/feed/stibmivb/static")))
    read = lambda f: csv.DictReader(io.TextIOWrapper(z.open(f), "utf-8-sig"))
    routes = {r["route_id"]: r for r in read("routes.txt")}
    shapes_of = defaultdict(Counter)  # line -> shape_id -> trip count
    for t in read("trips.txt"):
        shapes_of[routes[t["route_id"]]["route_short_name"]][t["shape_id"]] += 1
    wanted = {s for c in shapes_of.values() for s in c}
    shapes = defaultdict(list)
    for r in read("shapes.txt"):
        if r["shape_id"] in wanted:
            shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
    shapes = {k: [(la, lo) for _, la, lo in sorted(v)] for k, v in shapes.items()}

    lines = {r["route_short_name"]: {"color": "#" + r["route_color"], "text": "#" + r["route_text_color"],
                                     "mode": MODES.get(r["route_type"], "bus"), "name": r["route_long_name"].title()
                                     # "M6", "T39": buses standing in for a metro or tram during works
                                     + (" (replacement bus)" if r["route_short_name"][0] in "MT" else "")}
             for r in routes.values()}

    patterns, rough = [], []
    for r in pages("StopsByLine", 100):
        ids = [norm(p["id"]) for p in sorted(json.loads(r["points"]), key=lambda p: p["order"])]
        ids = [i for i in ids if i in stops]
        if r["lineid"] not in lines or len(ids) < 2:
            continue
        pts = [tuple(stops[i][:2]) for i in ids]
        # the line's shape that best follows these stops; straight lines between stops if none fits
        cands = sorted((fit(shapes[s], pts), s) for s in shapes_of[r["lineid"]] if s in shapes)
        if cands and cands[0][0] < 60:
            path = shapes[cands[0][1]]
            a, b = along(path, [pts[0]])[0], along(path, [pts[-1]])[0]
            cum = [0.0]
            for p, q in zip(path, path[1:]):
                cum.append(cum[-1] + metres(p, q))
            path = [p for p, c in zip(path, cum) if a - 1 <= c <= b + 1] or path  # trim to first..last stop
        else:
            path, rough = pts, rough + [(r["lineid"], round(cands[0][0]) if cands else None)]
        path = thin([pts[0], *path, pts[-1]])
        patterns.append({"line": r["lineid"], "to": ids[-1], "stops": ids, "at": along(path, pts),
                         "path": [[round(la, 5), round(lo, 5)] for la, lo in path]})

    used = {i for p in patterns for i in p["stops"]}
    print(f"{len(patterns)} patterns, {len(rough)} without a road shape {rough}, {len(used)} stops", file=sys.stderr)
    return {"lines": {k: v for k, v in lines.items() if any(p["line"] == k for p in patterns)},
            "stops": {k: v for k, v in stops.items() if k in used}, "patterns": patterns}


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "site/network.json"
    with open(out, "w") as f:
        json.dump(build(), f, separators=(",", ":"), ensure_ascii=False)
