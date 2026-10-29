import { useEffect, useRef, useState } from "react";
import { Search, Loader2, LocateFixed, MapPinPlus, LandPlot, X } from "lucide-react";
import { toast } from "sonner";
import { searchPlaces, type PlaceResult } from "@/lib/gis/geocode";
import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { defaultMarkerIcon } from "@/lib/gis/markerIcons";
import { ParcelSearchPanel } from "./ParcelSearchPanel";

export function SearchBox() {
  const { map } = useMapRef();
  const wb = useWorkbench();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [parcelSearchOpen, setParcelSearchOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      searchPlaces(query, controller.signal)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch((err: unknown) => {
          if ((err as Error)?.name !== "AbortError") setResults([]);
        })
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const goTo = (place: PlaceResult) => {
    if (!map) return;
    if (place.bbox) map.fitBounds(place.bbox, { padding: 80, maxZoom: 16 });
    else map.flyTo({ center: [place.lng, place.lat], zoom: 14 });
    setOpen(false);
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      toast.error("This browser can't share your location");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        map?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15 });
        toast.success("Jumped to your current place");
      },
      () => {
        setLoading(false);
        toast.error("Location permission was declined");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const addMarker = (place: PlaceResult) => {
    const feature = {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] },
      properties: {
        NAME: place.label,
        TYPE: place.type,
        LAT: Number(place.lat.toFixed(7)),
        LON: Number(place.lng.toFixed(7)),
        MARKER_ICON: defaultMarkerIcon.symbol,
        SOURCE: "Place search",
      },
    };
    const existing = wb.layers.find(
      (layer) => layer.groupId === "working" && layer.name === "Search markers",
    );
    if (existing) {
      const index = existing.data.features.length;
      wb.appendFeature(existing.id, feature);
      wb.setActiveLayer(existing.id);
      wb.setSelectedFeatures([{ layerId: existing.id, index }]);
      wb.addProjectEvent({
        type: "map",
        title: `Marked ${place.label}`,
        detail: `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`,
        relatedId: existing.id,
      });
    } else {
      const layer = wb.addLayer({
        name: "Search markers",
        data: { type: "FeatureCollection", features: [feature] },
        groupId: "working",
        source: { kind: "draw" },
        style: {
          fillColor: "#2f7d4f",
          strokeColor: "#ffffff",
          pointIcon: defaultMarkerIcon.symbol,
          pointIconSize: 20,
          labelEnabled: true,
          labelTemplate: "{NAME}",
          labelFields: ["NAME"],
          labelMinZoom: 12,
        },
      });
      wb.setSelectedFeatures([{ layerId: layer.id, index: 0 }]);
    }
    goTo(place);
    toast.success("Search result added to Working layers", {
      description: "Select the marker to change its icon, color, or size.",
    });
  };

  return (
    <div className={parcelSearchOpen ? "w-full sm:w-[34rem]" : "w-full sm:w-[22rem]"}>
      <div className="float-surface flex items-center gap-2 rounded-2xl px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search a place, address or lat, lon"
          aria-label="Search places"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="size-4 animate-spin text-primary" />}
        {query && !loading && (
          <button onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
            <X className="size-4 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={locateMe}
          title="Go to my current place"
          aria-label="Go to my current place"
          className="rounded-lg p-1 text-primary hover:bg-accent"
        >
          <LocateFixed className="size-4" />
        </button>
        <button
          onClick={() => {
            setParcelSearchOpen((current) => !current);
            setOpen(false);
          }}
          title="Search all Texas parcels"
          aria-label="Search all Texas parcels"
          aria-pressed={parcelSearchOpen}
          className={
            parcelSearchOpen
              ? "flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-primary-foreground"
              : "flex items-center gap-1 rounded-lg px-2 py-1 text-primary hover:bg-accent"
          }
        >
          <LandPlot className="size-4" />
          <span className="hidden text-[11px] font-semibold min-[480px]:inline">Parcels</span>
        </button>
      </div>

      {parcelSearchOpen && <ParcelSearchPanel onClose={() => setParcelSearchOpen(false)} />}

      {!parcelSearchOpen && open && results.length > 0 && (
        <div className="float-surface mt-2 max-h-[min(18rem,calc(100dvh-12rem))] overflow-auto rounded-2xl p-1">
          {results.map((r) => (
            <div
              key={r.id + r.label}
              className="flex items-center gap-1 rounded-xl hover:bg-accent"
            >
              <button
                onClick={() => goTo(r)}
                className="min-w-0 flex-1 px-3 py-2 text-left text-sm transition-colors hover:text-accent-foreground"
              >
                <div className="line-clamp-2">{r.label}</div>
                <div className="text-[11px] text-muted-foreground">{r.type}</div>
              </button>
              {wb.canEditProject && (
                <button
                  type="button"
                  onClick={() => addMarker(r)}
                  title="Add this location as a project marker"
                  aria-label={`Add ${r.label} as a marker`}
                  className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                >
                  <MapPinPlus className="size-4" />
                </button>
              )}
            </div>
          ))}
          <div className="px-3 py-1 text-[10px] text-muted-foreground">
            Place search by OpenStreetMap Nominatim
          </div>
        </div>
      )}
    </div>
  );
}
