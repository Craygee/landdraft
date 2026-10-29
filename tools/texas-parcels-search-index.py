"""Build a bounded R2 search index for the public TxGIO statewide parcel archive."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import time
import unicodedata

root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, os.environ.get("PARCEL_PYTHON_PATH", str(root / ".release/parcel-python")))
import numpy as np
import pyarrow as pa
import pyogrio
import pyproj
import shapely

from texas_parcels_schema import REQUIRED_FIELDS, resolve_fields

TEXT_PREFIX_LENGTH = 3
ID_PREFIX_LENGTH = 5
LEGAL_PREFIX_LENGTH = 3
MINIMUM_TEXT_LENGTH = 3
COUNTY_PREVIEW_LIMIT = 5000
BLOCK = re.compile(r"\b(?:BLK|BLOCK)\s*[-:#]?\s*([A-Z0-9][A-Z0-9.-]*)", re.I)
SECTION = re.compile(r"\b(?:SEC|SECTION)\s*[-:#]?\s*([A-Z0-9][A-Z0-9.-]*)", re.I)


def normalized(value):
    value = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char for char in value.upper() if char.isascii() and char.isalnum())


def string(value):
    if value is None:
        return ""
    return str(value).strip()


def compact_record(row, bounds, block, section):
    address = string(row.get("SITUS_ADDR"))
    if not address:
        address = " ".join(
            filter(
                None,
                [
                    string(row.get("SITUS_NUM")),
                    string(row.get("SITUS_STRE")),
                    string(row.get("SITUS_ST_1")),
                    string(row.get("SITUS_ST_2")),
                    string(row.get("SITUS_CITY")),
                    string(row.get("SITUS_STAT")),
                    string(row.get("SITUS_ZIP")),
                ],
            )
        )
    return {
        "sourceFeatureId": string(row.get("OBJECTID")),
        "propertyId": string(row.get("Prop_ID")),
        "geoId": string(row.get("GEO_ID")),
        "ownerName": string(row.get("OWNER_NAME")),
        "legalDescription": string(row.get("LEGAL_DESC")),
        "situsAddress": address,
        "county": string(row.get("COUNTY")),
        "fips": string(row.get("FIPS")),
        "block": block,
        "section": section,
        "bounds": [round(float(value), 7) for value in bounds],
    }


class Shards:
    def __init__(self, folder):
        self.folder = folder
        self.buffers = defaultdict(list)
        self.rows = defaultdict(int)

    def write(self, relative, line):
        key = relative.as_posix()
        self.buffers[key].append(line)
        self.rows[key] += 1

    def flush(self):
        for relative, lines in self.buffers.items():
            path = self.folder / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.writelines(lines)
        self.buffers.clear()


def compress(input):
    path, raw_folder, search_folder = input
    target = search_folder / path.relative_to(raw_folder)
    target = target.with_suffix(target.suffix + ".gz")
    target.parent.mkdir(parents=True, exist_ok=True)
    with path.open("rb") as source, gzip.open(target, "wb", compresslevel=6) as output:
        shutil.copyfileobj(source, output, length=1024 * 1024)
    path.unlink()
    return {
        "file": target.relative_to(search_folder).as_posix(),
        "bytes": target.stat().st_size,
        "sha256": hashlib.file_digest(target.open("rb"), "sha256").hexdigest(),
    }


def file_metadata(path, search_folder):
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {
        "file": path.relative_to(search_folder).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": digest,
    }


def pack_group(folder, search_folder, rows):
    files = sorted(folder.glob("*.ndjson.gz"))
    if not files:
        return []
    pack_path = folder / "data.pack"
    directory = {}
    offset = 0
    with pack_path.open("wb") as output:
        for path in files:
            length = path.stat().st_size
            prefix = path.name.removesuffix(".ndjson.gz")
            raw_key = path.relative_to(search_folder).with_suffix("").with_suffix("").as_posix()
            directory[prefix] = {"offset": offset, "length": length, "rows": rows.get(raw_key + ".ndjson", 0)}
            with path.open("rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            offset += length
            path.unlink()
    index_path = folder / "index.json"
    index_path.write_text(json.dumps({"schemaVersion": 1, "entries": directory}, separators=(",", ":")))
    return [file_metadata(index_path, search_folder), file_metadata(pack_path, search_folder)]


def main():
    store = pathlib.Path(os.environ.get("PARCEL_DATA_ROOT", str(root / ".data/texas-parcels")))
    source = json.loads((store / "current.json").read_text())
    version = source["sha256"][:16]
    version_folder = store / "index" / version
    manifest_path = version_folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest["sourceSha256"] != source["sha256"]:
        raise ValueError("Parcel source and spatial index versions do not match")
    search_folder = version_folder / "search"
    if search_folder.exists():
        if search_folder.parent.resolve() != version_folder.resolve():
            raise ValueError("Refusing to replace a search folder outside the parcel version")
        shutil.rmtree(search_folder)
    raw_folder = search_folder / "raw"
    raw_folder.mkdir(parents=True)
    shards = Shards(raw_folder)
    gdb = next((store / source["file"].removesuffix(".zip")).glob("*.gdb"))
    transform = pyproj.Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    counties = {}
    county_preview = defaultdict(int)
    mapped = 0
    started = time.time()
    with pyogrio.open_arrow(gdb, use_pyarrow=True, return_fids=True, batch_size=65536) as (meta, reader):
        if meta["crs"] != "EPSG:3857":
            raise ValueError("Source CRS changed; review required")
        geometry_name = meta["geometry_name"]
        for batch_index, batch in enumerate(reader):
            table = pa.Table.from_batches([batch])
            geometry = shapely.from_wkb(table[geometry_name].to_pylist())
            present = ~(shapely.is_missing(geometry) | shapely.is_empty(geometry))
            if not np.any(present):
                continue
            table = table.filter(pa.array(present))
            # Web Mercator is monotonic in X/Y. Transform each source envelope's corners instead
            # of every polygon vertex; this preserves the WGS84 search extent and avoids repeating
            # the much more expensive geometry conversion already done by the FlatGeobuf indexer.
            source_bounds = shapely.bounds(geometry[present])
            west, south = transform.transform(source_bounds[:, 0], source_bounds[:, 1])
            east, north = transform.transform(source_bounds[:, 2], source_bounds[:, 3])
            bounds = np.column_stack((west, south, east, north))
            source_fields = resolve_fields(table.column_names)
            columns = {
                canonical: table[source_fields[canonical]].to_pylist()
                for canonical in REQUIRED_FIELDS
            }
            for index in range(table.num_rows):
                row = {name: values[index] for name, values in columns.items()}
                legal = string(row["LEGAL_DESC"])
                block_match = BLOCK.search(legal)
                section_match = SECTION.search(legal)
                block = string(block_match.group(1) if block_match else "")
                section = string(section_match.group(1) if section_match else "")
                record = compact_record(row, bounds[index], block, section)
                county = normalized(record["county"])
                fips = record["fips"]
                if county and fips:
                    counties[fips] = record["county"].title()
                line = json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n"
                ids = {normalized(record["propertyId"]), normalized(record["geoId"])} - {""}
                for identifier in ids:
                    if len(identifier) >= MINIMUM_TEXT_LENGTH:
                        shards.write(pathlib.Path("id") / f"{identifier[:ID_PREFIX_LENGTH].lower()}.ndjson", line)
                owner = normalized(record["ownerName"])
                if len(owner) >= MINIMUM_TEXT_LENGTH:
                    shards.write(pathlib.Path("owner") / f"{owner[:TEXT_PREFIX_LENGTH].lower()}.ndjson", line)
                address = normalized(record["situsAddress"])
                if len(address) >= MINIMUM_TEXT_LENGTH:
                    shards.write(pathlib.Path("address") / f"{address[:TEXT_PREFIX_LENGTH].lower()}.ndjson", line)
                if fips and block:
                    key = normalized(block)
                    shards.write(pathlib.Path("block") / fips / f"{key[:LEGAL_PREFIX_LENGTH].lower()}.ndjson", line)
                if fips and section:
                    key = normalized(section)
                    shards.write(pathlib.Path("section") / fips / f"{key[:LEGAL_PREFIX_LENGTH].lower()}.ndjson", line)
                if fips and county_preview[fips] < COUNTY_PREVIEW_LIMIT:
                    shards.write(pathlib.Path("county") / f"{fips}.ndjson", line)
                    county_preview[fips] += 1
                mapped += 1
            shards.flush()
            if batch_index % 10 == 0:
                print(json.dumps({"searchRecords": mapped, "batch": batch_index, "seconds": round(time.time() - started)}), flush=True)
    shards.flush()
    if mapped != manifest["features"]:
        raise ValueError(f"Search index is incomplete: {mapped}/{manifest['features']}")
    raw_files = list(raw_folder.rglob("*.ndjson"))
    compressed = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item in pool.map(compress, [(path, raw_folder, search_folder) for path in raw_files]):
            compressed.append(item)
    shutil.rmtree(raw_folder)
    objects = []
    for category in ["id", "owner", "address", "county"]:
        objects.extend(pack_group(search_folder / category, search_folder, shards.rows))
    for category in ["block", "section"]:
        parent = search_folder / category
        if parent.exists():
            for county_folder in sorted(path for path in parent.iterdir() if path.is_dir()):
                objects.extend(pack_group(county_folder, search_folder, shards.rows))
    updated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest["schemaVersion"] = 2
    manifest["search"] = {
        "status": "ready",
        "schemaVersion": 2,
        "updatedAt": updated,
        "prefixLength": TEXT_PREFIX_LENGTH,
        "idPrefixLength": ID_PREFIX_LENGTH,
        "legalPrefixLength": LEGAL_PREFIX_LENGTH,
        "minimumTextLength": MINIMUM_TEXT_LENGTH,
        "maximumResults": 50,
        "countyPreviewLimit": COUNTY_PREVIEW_LIMIT,
        "counties": [
            {"name": name, "fips": fips} for fips, name in sorted(counties.items(), key=lambda item: item[1])
        ],
        "objects": len(objects),
        "bytes": sum(item["bytes"] for item in objects),
        "records": mapped,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    (search_folder / "objects.json").write_text(json.dumps(sorted(objects, key=lambda item: item["file"]), indent=2))
    print(json.dumps({"status": "ready", "records": mapped, "objects": len(objects), "bytes": manifest["search"]["bytes"], "seconds": round(time.time() - started)}), flush=True)


if __name__ == "__main__":
    main()
