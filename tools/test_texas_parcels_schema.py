import unittest

from texas_parcels_schema import REQUIRED_FIELDS, resolve_fields


class ParcelSchemaTests(unittest.TestCase):
    def test_accepts_legacy_mixed_case_fields(self):
        resolved = resolve_fields(REQUIRED_FIELDS)

        self.assertEqual(resolved["Prop_ID"], "Prop_ID")
        self.assertEqual(resolved["OBJECTID"], "OBJECTID")

    def test_accepts_new_lowercase_fields(self):
        resolved = resolve_fields([field.lower() for field in REQUIRED_FIELDS])

        self.assertEqual(resolved["Prop_ID"], "prop_id")
        self.assertEqual(resolved["OBJECTID"], "objectid")

    def test_rejects_a_missing_required_field(self):
        with self.assertRaisesRegex(ValueError, "Prop_ID"):
            resolve_fields([field for field in REQUIRED_FIELDS if field != "Prop_ID"])


if __name__ == "__main__":
    unittest.main()
