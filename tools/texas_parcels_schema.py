"""Normalize TxGIO parcel field names without coupling to source casing."""

REQUIRED_FIELDS = (
    "OBJECTID",
    "Prop_ID",
    "GEO_ID",
    "OWNER_NAME",
    "LEGAL_DESC",
    "SITUS_ADDR",
    "SITUS_NUM",
    "SITUS_STRE",
    "SITUS_ST_1",
    "SITUS_ST_2",
    "SITUS_CITY",
    "SITUS_STAT",
    "SITUS_ZIP",
    "FIPS",
    "COUNTY",
)


def resolve_fields(available_fields):
    """Return canonical-to-source field names using case-insensitive matching.

    TxGIO's 2026 statewide archive changed its FileGDB field names from mixed
    case to lowercase without changing their aliases or meaning. Keep the
    LandDraft search schema stable while accepting either representation.
    """

    by_casefold = {str(name).casefold(): str(name) for name in available_fields}
    resolved = {
        canonical: by_casefold.get(canonical.casefold()) for canonical in REQUIRED_FIELDS
    }
    missing = [canonical for canonical, source in resolved.items() if source is None]
    if missing:
        raise ValueError(
            "Parcel source schema is missing required fields: " + ", ".join(missing)
        )
    return resolved
