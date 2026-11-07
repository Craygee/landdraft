"""Build zoomed-out overview files of the larger Texas parcels.

A zoomed-out map view holds hundreds of thousands of parcels, far too many to
read from the full parts. Each overview tier keeps only parcels above a size,
with geometry simplified to well under a pixel at the zooms it serves and a
short list of attributes. The browser reads one tier with a bounding-box query,
like a part. The full parts stay the source of truth from zoom 12.

Run after the source archive is downloaded and inspected. It adds an `overview`
list to the version manifest in .data/texas-parcels/index/<version>/.
"""
import hashlib
import json
import math
import os
import pathlib
import sys
import time

root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, os.environ.get("PARCEL_PYTHON_PATH", str(root / ".release/parcel-python")))
import numpy as np
import pyarrow as pa
import pyogrio
import pyproj
import shapely

from texas_parcels_schema import resolve_fields

SCHEMA_VERSION = 1
SQUARE_METERS_PER_ACRE = 4046.8564224
# Each tier: smallest parcel kept, simplification in true ground meters, and the zooms it serves.
TIERS = (
    {"minAcres": 80, "toleranceMeters": 25, "minZoom": 8, "maxZoom": 10},
    {"minAcres": 5, "toleranceMeters": 6, "minZoom": 10, "maxZoom": 12},
)
KEPT_FIELDS = ("OBJECTID", "Prop_ID", "GEO_ID", "OWNER_NAME", "COUNTY", "FIPS")
EARTH_RADIUS = 6378137.0


def tier_file(tier):
    return f"overview-{tier['minAcres']:04d}.fgb"


def true_acres(geometries):
    """Ground area of Web Mercator polygons, correcting the scale at each centroid's latitude."""
    mercator_area = shapely.area(geometries)
    y = shapely.get_coordinates(shapely.centroid(geometries))[:, 1]
    latitude = np.arctan(np.sinh(y / EARTH_RADIUS))
    return mercator_area * np.cos(latitude) ** 2 / SQUARE_METERS_PER_ACRE


def select_tier(geometries, acres, tier):
    """Simplified copies of the parcels at or above the tier's size, plus the selection mask."""
    keep = acres >= tier["minAcres"]
    chosen = geometries[keep]
    if not len(chosen):
        return keep, chosen
    y = shapely.get_coordinates(shapely.centroid(chosen))[:, 1]
    scale = 1 / np.cos(np.arctan(np.sinh(y / EARTH_RADIUS)))
    # Simplify each parcel with a Mercator tolerance equal to the ground tolerance at its latitude.
    tolerance = tier["toleranceMeters"] * scale
    simplified = shapely.simplify(chosen, tolerance, preserve_topology=True)
    empty = shapely.is_empty(simplified) | shapely.is_missing(simplified)
    simplified[empty] = chosen[empty]
    return keep, simplified


def as_multipolygons(geometries):
    """The FlatGeobuf layer is MultiPolygon, like the parts; wrap single polygons."""
    single = shapely.get_type_id(geometries) == 3
    if np.any(single):
        geometries = geometries.copy()
        geometries[single] = [shapely.MultiPolygon([g]) for g in geometries[single]]
    return geometries


def build(gdb, out, tiers=TIERS, batch_size=65536, log=print):
    transform = pyproj.Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    collected = [[] for _ in tiers]
    started = time.time()
    scanned = 0
    # The FileGDB OBJECTID is the feature ID, not a field; return_fids adds it as a column.
    with pyogrio.open_arrow(gdb, use_pyarrow=True, return_fids=True, batch_size=batch_size) as (
        meta,
        reader,
    ):
        if meta["crs"] != "EPSG:3857":
            raise ValueError("Source CRS changed; review required")
        columns = None
        for index, batch in enumerate(reader):
            table = pa.Table.from_batches([batch])
            if columns is None:
                fields = resolve_fields(table.column_names)
                columns = [fields[name] for name in KEPT_FIELDS]
            geometries = shapely.from_wkb(table[meta["geometry_name"]].to_pylist())
            usable = ~(shapely.is_missing(geometries) | shapely.is_empty(geometries))
            if not np.all(usable):
                table = table.filter(pa.array(usable))
                geometries = geometries[usable]
            scanned += table.num_rows
            if not table.num_rows:
                continue
            acres = true_acres(geometries)
            for slot, tier in enumerate(tiers):
                keep, simplified = select_tier(geometries, acres, tier)
                if not len(simplified):
                    continue
                kept = table.select(columns).filter(pa.array(keep))
                lonlat = as_multipolygons(
                    shapely.transform(simplified, transform.transform, interleaved=False)
                )
                kept = kept.append_column("LD_ACRES", pa.array(np.round(acres[keep], 1)))
                kept = kept.append_column(
                    "geometry", pa.array(shapely.to_wkb(lonlat).tolist(), type=pa.binary())
                )
                collected[slot].append(kept)
            if index % 20 == 0:
                log(
                    json.dumps(
                        {
                            "scanned": scanned,
                            "kept": [sum(t.num_rows for t in c) for c in collected],
                            "seconds": round(time.time() - started),
                        }
                    )
                )
    entries = []
    for tier, tables in zip(tiers, collected):
        if not tables:
            raise ValueError(f"Overview tier {tier['minAcres']} acres is empty")
        table = pa.concat_tables(tables)
        file = out / tier_file(tier)
        pyogrio.write_arrow(
            table,
            file,
            driver="FlatGeobuf",
            geometry_name="geometry",
            geometry_type="MultiPolygon",
            crs="EPSG:4326",
            layer_options={"SPATIAL_INDEX": "YES"},
        )
        info = pyogrio.read_info(file, force_feature_count=True)
        if info["features"] != table.num_rows or info["crs"] != "EPSG:4326":
            raise ValueError("Overview verification failed")
        bounds = [float(v) for v in info["total_bounds"]]
        if not all(math.isfinite(v) for v in bounds):
            raise ValueError("Invalid overview bounds")
        with file.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        entries.append(
            {
                "file": file.name,
                "minAcres": tier["minAcres"],
                "toleranceMeters": tier["toleranceMeters"],
                "minZoom": tier["minZoom"],
                "maxZoom": tier["maxZoom"],
                "features": table.num_rows,
                "bytes": file.stat().st_size,
                "sha256": digest,
                "bounds": bounds,
            }
        )
        log(json.dumps({"file": file.name, "features": table.num_rows, "bytes": file.stat().st_size}))
    return {"schemaVersion": SCHEMA_VERSION, "tiers": entries, "scanned": scanned}


def main():
    store = root / ".data/texas-parcels"
    source = json.loads((store / "current.json").read_text())
    gdb = next((store / source["file"].removesuffix(".zip")).glob("*.gdb"))
    out = store / "index" / source["sha256"][:16]
    manifest_file = out / "manifest.json"
    manifest = json.loads(manifest_file.read_text())
    overview = build(gdb, out, log=lambda line: print(line, flush=True))
    scanned = overview.pop("scanned")
    mapped = manifest.get("features")
    if mapped and scanned != mapped:
        raise ValueError("Overview scan did not see every mapped parcel")
    manifest["overview"] = overview
    manifest_file.write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"status": "overview-ready", "tiers": overview["tiers"]}), flush=True)


if __name__ == "__main__":
    main()
