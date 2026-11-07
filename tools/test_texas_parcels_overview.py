import importlib.util
import pathlib
import tempfile
import unittest

import numpy as np
import pyarrow as pa
import pyogrio
import shapely

from texas_parcels_schema import REQUIRED_FIELDS

spec = importlib.util.spec_from_file_location(
    "overview", pathlib.Path(__file__).with_name("texas-parcels-overview.py")
)
overview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overview)

EARTH = 6378137.0


def mercator(lon, lat):
    return (
        np.radians(lon) * EARTH,
        np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * EARTH,
    )


def square(lon, lat, acres, wiggles=0):
    """A square of the given ground area at a latitude, in Web Mercator, with optional tiny bumps."""
    side = (acres * overview.SQUARE_METERS_PER_ACRE) ** 0.5 / np.cos(np.radians(lat))
    x, y = mercator(lon, lat)
    ring = [(x, y), (x + side, y), (x + side, y + side)]
    for i in range(wiggles):
        # Bumps of 1 m along the top edge; simplification should remove them.
        ring.append((x + side - side * (i + 0.5) / wiggles, y + side + (1 if i % 2 else 0)))
    ring += [(x, y + side), (x, y)]
    return shapely.Polygon(ring)


class OverviewTests(unittest.TestCase):
    def test_true_acres_corrects_for_latitude(self):
        areas = overview.true_acres(np.array([square(-99, 31, 100), square(-99, 36, 100)]))
        np.testing.assert_allclose(areas, [100, 100], rtol=0.01)

    def test_build_keeps_large_parcels_per_tier_and_simplifies(self):
        geometries = [
            square(-99.0, 31.0, 2),
            square(-99.1, 31.0, 20, wiggles=40),
            square(-99.2, 31.0, 500, wiggles=40),
            None,
        ]
        rows = len(geometries)
        # Like the FileGDB, the source has no OBJECTID field: it is the feature ID.
        columns = {
            field.lower(): [f"{field}-{i}" for i in range(rows)]
            for field in REQUIRED_FIELDS
            if field != "OBJECTID"
        }
        columns["geometry"] = [None if g is None else shapely.to_wkb(g) for g in geometries]
        table = pa.table(columns)
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            source = folder / "source.gpkg"
            pyogrio.write_arrow(
                table, source, driver="GPKG", geometry_name="geometry",
                geometry_type="Polygon", crs="EPSG:3857",
                layer_options={"FID": "OBJECTID"},
            )
            result = overview.build(source, folder, log=lambda _: None)
            self.assertEqual(result["scanned"], 3)
            tiers = {t["minAcres"]: t for t in result["tiers"]}
            self.assertEqual(tiers[80]["features"], 1)
            self.assertEqual(tiers[5]["features"], 2)
            _, large = pyogrio.read_arrow(folder / "overview-0005.fgb")
            self.assertEqual(
                sorted(large["owner_name"].to_pylist()), ["OWNER_NAME-1", "OWNER_NAME-2"]
            )
            self.assertIn("LD_ACRES", large.column_names)
            self.assertIn("OBJECTID", large.column_names)
            self.assertNotIn("legal_desc", large.column_names)
            # Bumps are gone and the shape is back to about its four corners.
            for geometry in shapely.from_wkb(large["wkb_geometry"].to_pylist()):
                self.assertLessEqual(len(shapely.get_coordinates(geometry)), 6)
            # Output is longitude/latitude.
            minx, miny, maxx, maxy = tiers[5]["bounds"]
            self.assertTrue(-100 < minx < maxx < -98 and 30 < miny < maxy < 32)


if __name__ == "__main__":
    unittest.main()
