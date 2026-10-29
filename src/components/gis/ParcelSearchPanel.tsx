import { useEffect, useRef, useState, type FormEvent } from "react";
import { Database, Loader2, MapPin, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useMapRef } from "@/lib/gis/mapRef";
import {
  getTexasParcelSearchMetadata,
  resolveTexasParcelSearchResult,
  searchTexasParcels,
  type TexasParcelSearchFilters,
  type TexasParcelSearchMetadata,
  type TexasParcelSearchResult,
} from "@/lib/gis/parcelSearch";
import { useWorkbench } from "@/lib/gis/store";

const blankFilters: TexasParcelSearchFilters = {
  county: "",
  owner: "",
  parcelId: "",
  block: "",
  section: "",
  address: "",
};

const Input = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <label className="space-y-1 text-[11px] font-semibold text-muted-foreground">
    <span>{label}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary"
    />
  </label>
);

export function ParcelSearchPanel({ onClose }: { onClose: () => void }) {
  const { map } = useMapRef();
  const wb = useWorkbench();
  const [metadata, setMetadata] = useState<TexasParcelSearchMetadata | null>(null);
  const [filters, setFilters] = useState<TexasParcelSearchFilters>(blankFilters);
  const [results, setResults] = useState<TexasParcelSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingParcel, setLoadingParcel] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getTexasParcelSearchMetadata(controller.signal)
      .then(setMetadata)
      .catch((reason: unknown) => {
        if ((reason as Error)?.name !== "AbortError")
          setError((reason as Error)?.message || "Statewide parcel search is unavailable.");
      });
    return () => controller.abort();
  }, []);

  const set = (key: keyof TexasParcelSearchFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await searchTexasParcels(filters, controller.signal);
      setResults(response.results);
      setLimited(response.limited);
      if (!response.results.length) setError("No parcels matched those filters.");
    } catch (reason) {
      if ((reason as Error)?.name !== "AbortError")
        setError((reason as Error)?.message || "Texas parcel search failed.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const goTo = (result: TexasParcelSearchResult) => {
    map?.fitBounds(
      [
        [result.bounds[0], result.bounds[1]],
        [result.bounds[2], result.bounds[3]],
      ],
      { padding: 90, maxZoom: 18 },
    );
  };

  const addParcel = async (result: TexasParcelSearchResult) => {
    const identity =
      result.propertyId || result.geoId || result.sourceFeatureId || result.ownerName || "parcel";
    setLoadingParcel(identity);
    try {
      const feature = await resolveTexasParcelSearchResult(result);
      feature.properties = {
        ...(feature.properties ?? {}),
        LD_SEARCH_MATCH: true,
        LD_SEARCHED_AT: new Date().toISOString(),
      };
      const existing = wb.layers.find(
        (layer) => layer.groupId === "public" && layer.name === "Texas parcel search results",
      );
      if (existing) {
        const index = existing.data.features.length;
        wb.appendFeature(existing.id, feature);
        wb.setActiveLayer(existing.id);
        wb.setSelectedFeatures([{ layerId: existing.id, index }]);
      } else {
        const layer = wb.addLayer({
          name: "Texas parcel search results",
          data: { type: "FeatureCollection", features: [feature] },
          groupId: "public",
          source: { kind: "import", fileName: "TxGIO statewide parcel search" },
          style: {
            fillColor: "#2f7d4f",
            fillOpacity: 0.18,
            strokeColor: "#166534",
            strokeWidth: 3,
            labelEnabled: true,
            labelTemplate: "{Prop_ID}",
            labelFields: ["Prop_ID", "GEO_ID"],
            labelMinZoom: 14,
          },
        });
        wb.setSelectedFeatures([{ layerId: layer.id, index: 0 }]);
      }
      wb.addProjectEvent({
        type: "public-data",
        title: `Added Texas parcel ${identity}`,
        detail: `${result.county} County · TxGIO statewide parcel search`,
      });
      goTo(result);
      toast.success("Parcel boundary added to Public data");
    } catch (reason) {
      toast.error("Parcel boundary could not be loaded", {
        description: (reason as Error)?.message,
      });
    } finally {
      setLoadingParcel(null);
    }
  };

  return (
    <div className="float-surface mt-2 max-h-[min(42rem,calc(100dvh-12rem))] w-full overflow-auto rounded-2xl p-3 sm:w-[34rem]">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Database className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Search all Texas parcels</div>
          <div className="text-[11px] leading-4 text-muted-foreground">
            Statewide TxGIO records, including parcels outside the current map view.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close parcel search"
          className="rounded-lg p-1 hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </div>

      <form onSubmit={runSearch} className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] font-semibold text-muted-foreground">
            <span>County</span>
            <select
              value={String(filters.county ?? "")}
              onChange={(event) => set("county", event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary"
            >
              <option value="">All Texas counties</option>
              {metadata?.counties.map((county) => (
                <option key={county.fips} value={county.name}>
                  {county.name}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Parcel / property ID"
            value={String(filters.parcelId ?? "")}
            onChange={(value) => set("parcelId", value)}
            placeholder="PROP_ID or GEO_ID"
          />
          <Input
            label="Owner / name starts with"
            value={String(filters.owner ?? "")}
            onChange={(value) => set("owner", value)}
            placeholder="Miller"
          />
          <Input
            label="Situs address starts with"
            value={String(filters.address ?? "")}
            onChange={(value) => set("address", value)}
            placeholder="1815 Treadwell"
          />
          <Input
            label="Block"
            value={String(filters.block ?? "")}
            onChange={(value) => set("block", value)}
            placeholder="B or 12"
          />
          <Input
            label="Section"
            value={String(filters.section ?? "")}
            onChange={(value) => set("section", value)}
            placeholder="1"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={loading || !metadata}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Search statewide
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(blankFilters);
              setResults([]);
              setError(null);
            }}
            className="h-10 rounded-xl border border-border px-3 text-xs font-semibold"
          >
            Clear
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {results.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {results.length} parcel{results.length === 1 ? "" : "s"} found
            </span>
            {limited && <span>More matches available — add another filter</span>}
          </div>
          {results.map((result, index) => {
            const identity =
              result.propertyId ||
              result.geoId ||
              result.sourceFeatureId ||
              `${result.fips}-${index}`;
            return (
              <div
                key={`${identity}-${index}`}
                className="flex items-center gap-2 rounded-xl border border-border bg-background/80 p-2"
              >
                <button
                  type="button"
                  onClick={() => goTo(result)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-semibold">
                    {result.ownerName || "Owner not provided"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {result.situsAddress ||
                      result.legalDescription ||
                      "No address or legal description"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                    <span>{result.county} County</span>
                    {result.propertyId && <span>Property {result.propertyId}</span>}
                    {result.geoId && <span>GEO {result.geoId}</span>}
                    {result.block && <span>Block {result.block}</span>}
                    {result.section && <span>Section {result.section}</span>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => goTo(result)}
                  title="Zoom to parcel"
                  aria-label={`Zoom to parcel ${identity}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                >
                  <MapPin className="size-4" />
                </button>
                {wb.canEditProject && (
                  <button
                    type="button"
                    onClick={() => addParcel(result)}
                    disabled={loadingParcel === identity}
                    title="Add parcel boundary to the project"
                    aria-label={`Add parcel ${identity}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    {loadingParcel === identity ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
          <div className="text-[10px] text-muted-foreground">
            Source: TxGIO statewide land parcels · CC0-1.0 · edition{" "}
            {metadata?.sourceDate ?? "current"}
          </div>
        </div>
      )}
    </div>
  );
}
