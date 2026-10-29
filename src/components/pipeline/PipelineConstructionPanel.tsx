import { useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { pipelineUnits } from "@/lib/pipeline/model";
import {
  CONSTRUCTION_EVIDENCE_RANK,
  createConstructionRange,
  createManualCrossing,
  estimateRockQuantity,
  trenchAssumptions,
  trenchDepthM,
  type ConstructionEvidence,
} from "@/lib/pipeline/constructability";
import { FACILITY_TAG_LABELS } from "@/lib/pipeline/siting";
import type {
  ConstructionCondition,
  ConstructionMethod,
  CrossingType,
  FacilityTag,
  LandFacilityPermission,
  PipeSpecification,
  PipelineCrossing,
  PipelineRoute,
  SolverFinding,
} from "@/lib/pipeline/types";
import { formatStation } from "@/components/pipeline/format";

const M_TO_FT = pipelineUnits.mToFt;
const M3_TO_YD3 = 1.307950619;

const METHODS: ConstructionMethod[] = [
  "open-trench",
  "plow",
  "bore",
  "hdd",
  "casing",
  "aerial",
  "existing-corridor",
  "aboveground",
  "other",
];
const CONDITIONS: ConstructionCondition[] = [
  "normal-soil",
  "difficult-soil",
  "shallow-rock-suspected",
  "rock",
  "high-groundwater",
  "steep-terrain",
  "wetland",
  "special-crossing",
];
const EVIDENCE = Object.keys(CONSTRUCTION_EVIDENCE_RANK).reverse() as ConstructionEvidence[];
const CROSSING_TYPES: CrossingType[] = [
  "paved-road",
  "highway",
  "railroad",
  "stream",
  "river",
  "drainage",
  "utility-corridor",
  "transmission-corridor",
  "wetland",
  "floodplain",
  "other",
];
const FACILITY_TAGS = Object.keys(FACILITY_TAG_LABELS) as FacilityTag[];

const label = (value: string) => value.replaceAll("-", " ");

export interface PolygonCandidateOption {
  key: string;
  layerId: string;
  featureIndex: number;
  label: string;
}

export function PipelineConstructionPanel({
  route,
  pipe,
  landPermissions,
  polygonCandidates,
  sitingFindings,
  onRouteChange,
  onLandPermissionsChange,
}: {
  route: PipelineRoute;
  pipe: PipeSpecification | undefined;
  landPermissions: LandFacilityPermission[];
  polygonCandidates: PolygonCandidateOption[];
  sitingFindings: SolverFinding[];
  onRouteChange: (change: (route: PipelineRoute) => PipelineRoute) => void;
  onLandPermissionsChange: (permissions: LandFacilityPermission[]) => void;
}) {
  const trench = trenchAssumptions(route);
  const patchTrench = (change: Partial<typeof trench>) =>
    onRouteChange((current) => ({ ...current, trench: { ...current.trench, ...change } }));
  const rock = pipe ? estimateRockQuantity(route, pipe) : undefined;
  return (
    <div className="mt-4 space-y-4 text-[10px]">
      <p className="rounded-xl bg-secondary p-3 leading-relaxed">
        Construction conditions are screening assumptions. Mapped soil or geology is not a confirmed
        excavation condition; field or geotechnical evidence overrides everything else.
      </p>

      <Section title="Trench and rock">
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Trench width"
            unit="ft"
            value={trench.trenchWidthM * M_TO_FT}
            onChange={(value) => patchTrench({ trenchWidthM: Math.max(0, value / M_TO_FT) })}
          />
          <Field
            label="Bedding below pipe"
            unit="ft"
            value={trench.beddingBelowPipeM * M_TO_FT}
            onChange={(value) => patchTrench({ beddingBelowPipeM: Math.max(0, value / M_TO_FT) })}
          />
          <Field
            label="Clearing width"
            unit="ft"
            value={(trench.clearingWidthM ?? 0) * M_TO_FT}
            onChange={(value) => patchTrench({ clearingWidthM: Math.max(0, value / M_TO_FT) })}
          />
          <Field
            label="Rock allowance"
            unit="% of trench"
            value={trench.rockAllowancePercent}
            onChange={(value) =>
              patchTrench({ rockAllowancePercent: Math.max(0, Math.min(100, value)) })
            }
          />
        </div>
        <Select
          label="Default method outside ranges"
          value={trench.defaultMethod}
          options={METHODS}
          onChange={(value) => patchTrench({ defaultMethod: value as ConstructionMethod })}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={trench.blastingPermitted}
            onChange={(event) => patchTrench({ blastingPermitted: event.target.checked })}
          />
          Blasting explicitly permitted on this route
        </label>
        {pipe && rock && (
          <dl className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-2">
            <dt className="text-muted-foreground">Trench depth</dt>
            <dd className="num text-right">
              {(trenchDepthM(route, pipe) * M_TO_FT).toFixed(2)} ft
            </dd>
            <dt className="text-muted-foreground">Rock (ranges)</dt>
            <dd className="num text-right">{(rock.rangedVolumeM3 * M3_TO_YD3).toFixed(0)} yd³</dd>
            <dt className="text-muted-foreground">Rock (allowance)</dt>
            <dd className="num text-right">
              {(rock.allowanceVolumeM3 * M3_TO_YD3).toFixed(0)} yd³
            </dd>
          </dl>
        )}
      </Section>

      <Section title="Construction ranges">
        {route.constructionRanges.map((range) => (
          <Row
            key={range.id}
            onRemove={() =>
              onRouteChange((current) => ({
                ...current,
                constructionRanges: current.constructionRanges.filter(
                  (item) => item.id !== range.id,
                ),
              }))
            }
          >
            <span className="num">
              {formatStation(range.startStationM)} – {formatStation(range.endStationM)}
            </span>{" "}
            · {label(range.method)} · {range.conditions.map(label).join(", ")}
            <span className="block text-muted-foreground">{label(range.evidence)}</span>
          </Row>
        ))}
        <RangeForm
          route={route}
          onAdd={(range) =>
            onRouteChange((current) => ({
              ...current,
              constructionRanges: [...current.constructionRanges, range],
            }))
          }
        />
      </Section>

      <Section title="Crossings">
        {route.crossings.map((crossing) => (
          <CrossingRow
            key={crossing.id}
            crossing={crossing}
            onChange={(change) =>
              onRouteChange((current) => ({
                ...current,
                crossings: current.crossings.map((item) =>
                  item.id === crossing.id ? { ...item, ...change } : item,
                ),
              }))
            }
            onRemove={() =>
              onRouteChange((current) => ({
                ...current,
                crossings: current.crossings.filter((item) => item.id !== crossing.id),
              }))
            }
          />
        ))}
        <CrossingForm
          route={route}
          onAdd={(crossing) =>
            onRouteChange((current) => ({
              ...current,
              crossings: [...current.crossings, crossing],
            }))
          }
        />
        <p className="text-muted-foreground">
          Automatic detection from mapped datasets is not enabled yet. Detected candidates will
          arrive unreviewed and never confirm buried utilities or subsurface conditions.
        </p>
      </Section>

      <Section title="Facility siting on land">
        {sitingFindings.map((finding) => (
          <p
            key={finding.id}
            className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-900"
          >
            <strong className="block">{finding.title}</strong>
            {finding.detail}
          </p>
        ))}
        {landPermissions.map((permission) => (
          <div key={permission.id} className="rounded-lg border border-border p-2">
            <div className="flex items-start gap-2">
              <strong className="min-w-0 flex-1 truncate">{permission.label}</strong>
              <RemoveButton
                label={`Remove siting rules for ${permission.label}`}
                onClick={() =>
                  onLandPermissionsChange(
                    landPermissions.filter((item) => item.id !== permission.id),
                  )
                }
              />
            </div>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={permission.noFacilities}
                onChange={(event) =>
                  onLandPermissionsChange(
                    landPermissions.map((item) =>
                      item.id === permission.id
                        ? { ...item, noFacilities: event.target.checked, updatedAt: Date.now() }
                        : item,
                    ),
                  )
                }
              />
              No facilities
            </label>
            <div
              className={cn("mt-1 grid grid-cols-2 gap-1", permission.noFacilities && "opacity-50")}
            >
              {FACILITY_TAGS.map((tag) => (
                <label key={tag} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={permission.noFacilities}
                    checked={permission.allowed.includes(tag)}
                    onChange={(event) =>
                      onLandPermissionsChange(
                        landPermissions.map((item) =>
                          item.id === permission.id
                            ? {
                                ...item,
                                allowed: event.target.checked
                                  ? [...item.allowed, tag]
                                  : item.allowed.filter((value) => value !== tag),
                                updatedAt: Date.now(),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  {FACILITY_TAG_LABELS[tag]}
                </label>
              ))}
            </div>
          </div>
        ))}
        <select
          value=""
          onChange={(event) => {
            const candidate = polygonCandidates.find((item) => item.key === event.target.value);
            if (!candidate) return;
            onLandPermissionsChange([
              ...landPermissions,
              {
                id: `land-${Date.now()}`,
                layerId: candidate.layerId,
                featureIndex: candidate.featureIndex,
                label: candidate.label,
                noFacilities: false,
                allowed: [],
                updatedAt: Date.now(),
              },
            ]);
          }}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
          disabled={!polygonCandidates.length}
        >
          <option value="">
            {polygonCandidates.length ? "Tag a parcel or area…" : "No polygon features on the map"}
          </option>
          {polygonCandidates
            .filter(
              (candidate) =>
                !landPermissions.some(
                  (permission) =>
                    permission.layerId === candidate.layerId &&
                    permission.featureIndex === candidate.featureIndex,
                ),
            )
            .map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
        </select>
        <p className="text-muted-foreground">
          A tagged area permits only the facility classes checked. Untagged land imposes no rule.
        </p>
      </Section>
    </div>
  );
}

function RangeForm({
  route,
  onAdd,
}: {
  route: PipelineRoute;
  onAdd: (range: PipelineRoute["constructionRanges"][number]) => void;
}) {
  const [startFt, setStartFt] = useState(0);
  const [endFt, setEndFt] = useState(Math.round(route.lengthM * M_TO_FT));
  const [method, setMethod] = useState<ConstructionMethod>("open-trench");
  const [condition, setCondition] = useState<ConstructionCondition>("rock");
  const [evidence, setEvidence] = useState<ConstructionEvidence>("user-confirmed");
  return (
    <div className="space-y-2 rounded-lg bg-secondary p-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="From station" unit="ft" value={startFt} onChange={setStartFt} />
        <Field label="To station" unit="ft" value={endFt} onChange={setEndFt} />
        <Select
          label="Method"
          value={method}
          options={METHODS}
          onChange={(value) => setMethod(value as ConstructionMethod)}
        />
        <Select
          label="Condition"
          value={condition}
          options={CONDITIONS}
          onChange={(value) => setCondition(value as ConstructionCondition)}
        />
      </div>
      <Select
        label="Evidence"
        value={evidence}
        options={EVIDENCE}
        onChange={(value) => setEvidence(value as ConstructionEvidence)}
      />
      <AddButton
        onClick={() =>
          onAdd(
            createConstructionRange({
              route,
              startStationM: startFt / M_TO_FT,
              endStationM: endFt / M_TO_FT,
              method,
              conditions: [condition],
              evidence,
              source: "User-entered range",
            }),
          )
        }
      >
        Add range
      </AddButton>
    </div>
  );
}

function CrossingForm({
  route,
  onAdd,
}: {
  route: PipelineRoute;
  onAdd: (crossing: PipelineCrossing) => void;
}) {
  const [stationFt, setStationFt] = useState(0);
  const [lengthFt, setLengthFt] = useState(0);
  const [type, setType] = useState<CrossingType>("paved-road");
  return (
    <div className="space-y-2 rounded-lg bg-secondary p-2">
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Type"
          value={type}
          options={CROSSING_TYPES}
          onChange={(value) => setType(value as CrossingType)}
        />
        <Field label="Station" unit="ft" value={stationFt} onChange={setStationFt} />
        <Field label="Special length" unit="ft" value={lengthFt} onChange={setLengthFt} />
      </div>
      <AddButton
        onClick={() =>
          onAdd(
            createManualCrossing({
              route,
              type,
              stationM: stationFt / M_TO_FT,
              ...(lengthFt > 0 ? { crossingLengthM: lengthFt / M_TO_FT } : {}),
            }),
          )
        }
      >
        Add crossing
      </AddButton>
    </div>
  );
}

function CrossingRow({
  crossing,
  onChange,
  onRemove,
}: {
  crossing: PipelineCrossing;
  onChange: (change: Partial<PipelineCrossing>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2",
        crossing.confirmation === "unreviewed"
          ? "border-amber-200 bg-amber-50"
          : crossing.confirmation === "rejected"
            ? "border-border opacity-60"
            : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <strong className="capitalize">{label(crossing.type)}</strong> ·{" "}
          <span className="num">{formatStation(crossing.stationM)}</span> · {crossing.confirmation}
          <span className="block text-muted-foreground">
            {crossing.source} · {crossing.confidence} confidence
          </span>
        </span>
        <RemoveButton label="Remove crossing" onClick={onRemove} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Select
          label="Method"
          value={crossing.constructionMethod ?? "other"}
          options={METHODS}
          onChange={(value) =>
            onChange({ constructionMethod: value as ConstructionMethod, confirmation: "corrected" })
          }
        />
        <Field
          label="Special length"
          unit="ft"
          value={(crossing.crossingLengthM ?? 0) * M_TO_FT}
          onChange={(value) =>
            onChange({ crossingLengthM: Math.max(0, value / M_TO_FT), confirmation: "corrected" })
          }
        />
      </div>
      {crossing.confirmation !== "confirmed" && crossing.confirmation !== "corrected" && (
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={() => onChange({ confirmation: "confirmed" })}
            className="rounded-md bg-primary px-2 py-1 font-semibold text-primary-foreground"
          >
            Confirm
          </button>
          {crossing.confirmation !== "rejected" && (
            <button
              type="button"
              onClick={() => onChange({ confirmation: "rejected" })}
              className="rounded-md bg-secondary px-2 py-1 font-semibold"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border p-2">
      <span className="min-w-0 flex-1">{children}</span>
      <RemoveButton label="Remove" onClick={onRemove} />
    </div>
  );
}

function RemoveButton({ label: text, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-700"
      aria-label={text}
      title={text}
    >
      <Trash2 className="size-3" />
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg bg-card px-2 py-2 text-[9px] font-semibold hover:bg-accent"
    >
      {children}
    </button>
  );
}

function Field({
  label: text,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between font-medium">
        <span>{text}</span>
        <span className="text-muted-foreground">{unit}</span>
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="num w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
      />
    </label>
  );
}

function Select({
  label: text,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-medium">{text}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs capitalize"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {label(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
