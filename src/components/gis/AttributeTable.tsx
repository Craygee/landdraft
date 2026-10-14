import { useEffect, useMemo, useState } from "react";
import { bbox as turfBbox } from "@turf/turf";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckSquare,
  ClipboardCopy,
  CopyPlus,
  Crosshair,
  ListFilter,
  Pencil,
  Plus,
  Table2,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import { propertyKeys } from "@/lib/gis/labels";
import { formatArea, squareMeters } from "@/lib/gis/measure";
import {
  attributeRowsToTsv,
  compareAttributeValues,
  matchesAttributeFilter,
  parseAttributeValue,
  parseEditedAttributeValue,
  type AttributeFilter,
  type AttributeFilterOperator,
  type AttributeSortDirection,
} from "@/lib/gis/attributeTable";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;
type RowScope = "selected" | "filtered" | "all";
type ValueType = "text" | "number" | "boolean" | "null";
type BulkAction = "fill" | "copy_field" | "copy_first_selected" | "clear";
const VALUE_FREE_OPERATORS = new Set<AttributeFilterOperator>(["empty", "not_empty"]);

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function ScopeSelect({
  value,
  onChange,
  selectedCount,
  filteredCount,
  totalCount,
}: {
  value: RowScope;
  onChange: (value: RowScope) => void;
  selectedCount: number;
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RowScope)}
      aria-label="Rows to update"
      className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
    >
      <option value="selected">Selected rows ({selectedCount})</option>
      <option value="filtered">Filtered rows ({filteredCount})</option>
      <option value="all">All rows ({totalCount})</option>
    </select>
  );
}

export function AttributeTable() {
  const wb = useWorkbench();
  const { tableOpen, setTableOpen, map, setPendingFeatureSave } = useMapRef();
  const [query, setQuery] = useState("");
  const [filterField, setFilterField] = useState("");
  const [filterOperator, setFilterOperator] = useState<AttributeFilterOperator>("contains");
  const [filterValue, setFilterValue] = useState("");
  const [filters, setFilters] = useState<AttributeFilter[]>([]);
  const [sortField, setSortField] = useState("");
  const [sortDirection, setSortDirection] = useState<AttributeSortDirection>("asc");
  const [page, setPage] = useState(0);
  const [editingCell, setEditingCell] = useState<{ index: number; key: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<ValueType>("text");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [newFieldScope, setNewFieldScope] = useState<RowScope>("all");
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkAction, setBulkAction] = useState<BulkAction>("fill");
  const [bulkSource, setBulkSource] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkValueType, setBulkValueType] = useState<ValueType>("text");
  const [bulkScope, setBulkScope] = useState<RowScope>("selected");
  const [copyScope, setCopyScope] = useState<RowScope>("selected");
  const layer = wb.activeLayer;
  const editable = Boolean(layer && wb.canEditProject);

  const keys = useMemo(
    () =>
      layer
        ? propertyKeys(layer.data.features as never).filter((key) => !key.startsWith("__"))
        : [],
    [layer],
  );

  const unsortedRows = useMemo(() => {
    if (!layer) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return layer.data.features
      .map((f, index) => ({ f, index }))
      .filter(({ f }) => {
        const properties = (f.properties ?? {}) as Record<string, unknown>;
        const searchMatch = normalizedQuery
          ? Object.values(properties).some((value) =>
              String(value ?? "")
                .toLocaleLowerCase()
                .includes(normalizedQuery),
            )
          : true;
        return searchMatch && filters.every((filter) => matchesAttributeFilter(properties, filter));
      });
  }, [filters, layer, query]);

  const rows = useMemo(() => {
    if (!sortField) return unsortedRows;
    return [...unsortedRows].sort((a, b) => {
      const aValue =
        sortField === "__feature"
          ? a.index
          : sortField === "__area"
            ? squareMeters(a.f)
            : (a.f.properties ?? {})[sortField];
      const bValue =
        sortField === "__feature"
          ? b.index
          : sortField === "__area"
            ? squareMeters(b.f)
            : (b.f.properties ?? {})[sortField];
      return compareAttributeValues(aValue, bValue, sortDirection);
    });
  }, [sortDirection, sortField, unsortedRows]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = useMemo(
    () => rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [rows, safePage],
  );
  const selectedIndexes = useMemo(
    () =>
      new Set(
        wb.selectedFeatures
          .filter((selection) => selection.layerId === layer?.id)
          .map((selection) => selection.index),
      ),
    [layer?.id, wb.selectedFeatures],
  );

  useEffect(() => setPage(0), [filters, layer?.id, query, sortDirection, sortField]);
  useEffect(() => {
    setFilters([]);
    setFilterField("");
    setSortField("");
    setEditingCell(null);
    setShowAddField(false);
    setShowBulkEdit(false);
  }, [layer?.id]);

  const rowsForScope = (scope: RowScope) => {
    if (!layer) return [];
    if (scope === "all") return layer.data.features.map((f, index) => ({ f, index }));
    if (scope === "filtered") return rows;
    return layer.data.features
      .map((f, index) => ({ f, index }))
      .filter(({ index }) => selectedIndexes.has(index));
  };

  const addFilter = () => {
    if (!filterField) return void toast.error("Choose a field to filter.");
    if (!VALUE_FREE_OPERATORS.has(filterOperator) && !filterValue.trim())
      return void toast.error("Enter a filter value.");
    setFilters((current) => [
      ...current,
      { id: crypto.randomUUID(), field: filterField, operator: filterOperator, value: filterValue },
    ]);
    setFilterValue("");
  };

  const toggleSort = (nextField: string) => {
    if (sortField !== nextField) {
      setSortField(nextField);
      setSortDirection("asc");
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }
    setSortField("");
    setSortDirection("asc");
  };

  const sortIcon = (column: string) =>
    sortField !== column ? (
      <ArrowUpDown className="size-3 opacity-45" />
    ) : sortDirection === "asc" ? (
      <ArrowUp className="size-3 text-primary" />
    ) : (
      <ArrowDown className="size-3 text-primary" />
    );

  const selectResults = () => {
    if (layer) wb.setSelectedFeatures(rows.map(({ index }) => ({ layerId: layer.id, index })));
  };

  const createFromResults = () => {
    if (!layer || rows.length === 0) return;
    setPendingFeatureSave({
      features: rows.map(({ f }) => structuredClone(f)),
      suggestedLayerName: `${layer.name} · selection`,
      defaultGroupId: wb.derivedLayerGroupId,
      source: {
        kind: "derived",
        sourceLayerId: layer.id,
        query: filters.length
          ? filters.map((f) => `${f.field} ${f.operator} ${f.value}`).join(" AND ")
          : query,
      },
      style: layer.style,
    });
  };

  const addField = () => {
    if (!layer) return;
    const name = newFieldName.trim();
    if (!name || name.startsWith("__"))
      return void toast.error("Enter a field name that does not begin with __.");
    if (keys.includes(name)) return void toast.error(`The field “${name}” already exists.`);
    const scopedRows = rowsForScope(newFieldScope);
    if (!scopedRows.length) return void toast.error("There are no rows in that scope.");
    try {
      if (newFieldType === "number" && !newFieldValue.trim())
        throw new Error("Enter a numeric default value.");
      const parsed = parseAttributeValue(newFieldValue, newFieldType);
      const scopedIndexes = new Set(scopedRows.map(({ index }) => index));
      wb.updateFeaturesProperties(
        layer.id,
        layer.data.features.map((_, index) => ({
          index,
          properties: { [name]: scopedIndexes.has(index) ? parsed : null },
        })),
      );
      setNewFieldName("");
      setNewFieldValue("");
      setShowAddField(false);
      toast.success(
        `Added “${name}” to ${scopedRows.length} row${scopedRows.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the field.");
    }
  };

  const applyBulkEdit = () => {
    if (!layer || !bulkTarget) return void toast.error("Choose a target field.");
    const scopedRows = rowsForScope(bulkScope);
    if (!scopedRows.length) return void toast.error("There are no rows in that scope.");
    const selectedSourceIndex = [...selectedIndexes].sort((a, b) => a - b)[0];
    if (bulkAction === "copy_field" && !bulkSource)
      return void toast.error("Choose the field to copy from.");
    if (bulkAction === "copy_first_selected" && selectedSourceIndex === undefined)
      return void toast.error("Select a source row first.");
    try {
      if (bulkAction === "fill" && bulkValueType === "number" && !bulkValue.trim())
        throw new Error("Enter a numeric value.");
      const fillValue =
        bulkAction === "fill" ? parseAttributeValue(bulkValue, bulkValueType) : undefined;
      const selectedValue =
        selectedSourceIndex === undefined
          ? undefined
          : (layer.data.features[selectedSourceIndex]?.properties ?? {})[bulkTarget];
      wb.updateFeaturesProperties(
        layer.id,
        scopedRows.map(({ f, index }) => ({
          index,
          properties: {
            [bulkTarget]:
              bulkAction === "clear"
                ? null
                : bulkAction === "copy_field"
                  ? (f.properties ?? {})[bulkSource]
                  : bulkAction === "copy_first_selected"
                    ? selectedValue
                    : fillValue,
          },
        })),
      );
      toast.success(
        `Updated ${scopedRows.length} row${scopedRows.length === 1 ? "" : "s"} in “${bulkTarget}”.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the rows.");
    }
  };

  const copyRows = async () => {
    const scopedRows = rowsForScope(copyScope);
    if (!scopedRows.length) return void toast.error("There are no rows in that scope.");
    const text = attributeRowsToTsv(
      scopedRows.map(({ f, index }) => ({ index, properties: f.properties })),
      keys,
    );
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${scopedRows.length} row${scopedRows.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("The browser could not copy these rows.");
    }
  };

  const saveCell = (index: number, key: string) => {
    if (!layer) return;
    const previous = (layer.data.features[index]?.properties ?? {})[key];
    try {
      const parsed = parseEditedAttributeValue(editDraft, previous);
      setEditingCell(null);
      wb.updateFeatureProperties(layer.id, index, { [key]: parsed });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this value.");
    }
  };

  if (!tableOpen) return null;

  return (
    <div className="attribute-table-height panel-surface flex flex-col rounded-t-2xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Table2 className="size-4 text-primary" />
        <span className="text-sm font-semibold">{layer ? layer.name : "Attribute table"}</span>
        <span className="num rounded-full bg-secondary px-2 text-[10px] text-muted-foreground">
          {rows.length} of {layer?.data.features.length ?? 0} rows
        </span>
        {rows.length > PAGE_SIZE && (
          <div className="flex items-center gap-1 text-[10px]">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!safePage}
              className="rounded-md bg-secondary px-2 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="num text-muted-foreground">
              {safePage + 1}/{pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded-md bg-secondary px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1">
            <ListFilter className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all attributes"
              className="w-32 bg-transparent text-xs outline-none sm:w-48"
            />
          </label>
          <button
            onClick={() => setTableOpen(false)}
            aria-label="Close table"
            title="Close the attribute table"
            className="rounded-lg p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {layer && (
        <>
          <FilterToolbar
            keys={keys}
            field={filterField}
            setField={setFilterField}
            operator={filterOperator}
            setOperator={setFilterOperator}
            value={filterValue}
            setValue={setFilterValue}
            addFilter={addFilter}
            selectResults={selectResults}
            rowCount={rows.length}
            editable={editable}
            showAddField={showAddField}
            setShowAddField={setShowAddField}
            showBulkEdit={showBulkEdit}
            setShowBulkEdit={setShowBulkEdit}
            createFromResults={createFromResults}
          />

          {filters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Active filters
              </span>
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() =>
                    setFilters((current) => current.filter((item) => item.id !== filter.id))
                  }
                  title="Remove this filter"
                  className="flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-[10px]"
                >
                  {filter.field} {filter.operator.replaceAll("_", " ")}
                  {VALUE_FREE_OPERATORS.has(filter.operator) ? "" : ` “${filter.value}”`}
                  <X className="size-3" />
                </button>
              ))}
              <button
                onClick={() => setFilters([])}
                className="ml-1 text-[10px] font-semibold text-primary hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {showAddField && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2">
              <span className="text-xs font-semibold">Add attribute field</span>
              <input
                autoFocus
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Field name"
                className="w-40 rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
              />
              <ValueInput
                type={newFieldType}
                setType={setNewFieldType}
                value={newFieldValue}
                setValue={setNewFieldValue}
                placeholder="Default value"
              />
              <ScopeSelect
                value={newFieldScope}
                onChange={setNewFieldScope}
                selectedCount={selectedIndexes.size}
                filteredCount={rows.length}
                totalCount={layer.data.features.length}
              />
              <button
                onClick={addField}
                className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs text-primary-foreground"
              >
                <Check className="size-3.5" /> Add field
              </button>
            </div>
          )}

          {showBulkEdit && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2">
              <span className="text-xs font-semibold">Bulk values</span>
              <FieldSelect
                keys={keys}
                value={bulkTarget}
                setValue={setBulkTarget}
                label="Target field"
              />
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value as BulkAction)}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
              >
                <option value="fill">Set one value</option>
                <option value="copy_field">Copy from another field</option>
                <option value="copy_first_selected">Copy first selected row down</option>
                <option value="clear">Clear to NULL</option>
              </select>
              {bulkAction === "copy_field" && (
                <FieldSelect
                  keys={keys}
                  value={bulkSource}
                  setValue={setBulkSource}
                  label="Source field"
                />
              )}
              {bulkAction === "fill" && (
                <ValueInput
                  type={bulkValueType}
                  setType={setBulkValueType}
                  value={bulkValue}
                  setValue={setBulkValue}
                  placeholder="Value"
                />
              )}
              <ScopeSelect
                value={bulkScope}
                onChange={setBulkScope}
                selectedCount={selectedIndexes.size}
                filteredCount={rows.length}
                totalCount={layer.data.features.length}
              />
              <button
                onClick={applyBulkEdit}
                className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs text-primary-foreground"
              >
                <Check className="size-3.5" /> Apply
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
            <ClipboardCopy className="size-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Copy table data
            </span>
            <ScopeSelect
              value={copyScope}
              onChange={setCopyScope}
              selectedCount={selectedIndexes.size}
              filteredCount={rows.length}
              totalCount={layer.data.features.length}
            />
            <button
              onClick={() => void copyRows()}
              className="rounded-lg bg-secondary px-2 py-1 text-xs hover:bg-accent"
            >
              Copy rows
            </button>
            {editable && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                <Pencil className="size-3" /> Double-click a cell to edit it
              </span>
            )}
          </div>
        </>
      )}

      {!layer ? (
        <p className="p-4 text-sm text-muted-foreground">
          Pick a layer in the panel to browse its attributes.
        </p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr>
                <SortHeader
                  label="#"
                  column="__feature"
                  toggleSort={toggleSort}
                  sortIcon={sortIcon}
                />
                <SortHeader
                  label="Area"
                  column="__area"
                  toggleSort={toggleSort}
                  sortIcon={sortIcon}
                />
                {keys.map((key) => (
                  <SortHeader
                    key={key}
                    label={key}
                    column={key}
                    toggleSort={toggleSort}
                    sortIcon={sortIcon}
                  />
                ))}
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ f, index }) => {
                const selected = selectedIndexes.has(index);
                const area = squareMeters(f);
                return (
                  <tr
                    key={index}
                    onClick={(event) => {
                      const selection = { layerId: layer.id, index };
                      if (event.shiftKey || event.ctrlKey || event.metaKey)
                        wb.setSelectedFeatures(
                          selected
                            ? wb.selectedFeatures.filter(
                                (item) => item.layerId !== layer.id || item.index !== index,
                              )
                            : [...wb.selectedFeatures, selection],
                        );
                      else wb.setSelectedFeature(selection);
                    }}
                    className={cn(
                      "cursor-pointer border-b border-border/60",
                      selected ? "bg-accent" : "hover:bg-secondary/60",
                    )}
                  >
                    <td className="num px-2 py-1 text-muted-foreground">{index + 1}</td>
                    <td className="num whitespace-nowrap px-2 py-1">
                      {area > 0 ? formatArea(area, wb.units.area) : "—"}
                    </td>
                    {keys.map((key) => {
                      const cellValue = (f.properties ?? {})[key];
                      const editing = editingCell?.index === index && editingCell.key === key;
                      const startEditing = () => {
                        setEditingCell({ index, key });
                        setEditDraft(displayValue(cellValue));
                      };
                      return (
                        <td
                          key={key}
                          onDoubleClick={(event) => {
                            if (!editable) return;
                            event.stopPropagation();
                            startEditing();
                          }}
                          title={editable ? "Double-click to edit" : displayValue(cellValue)}
                          className="group max-w-56 px-2 py-1"
                        >
                          {editing ? (
                            <input
                              autoFocus
                              value={editDraft}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onBlur={() => saveCell(index, key)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") saveCell(index, key);
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                              aria-label={`Edit ${key}`}
                              className="min-w-28 rounded border border-primary bg-card px-1 py-0.5 outline-none"
                            />
                          ) : (
                            <span className="flex min-w-24 items-center gap-1">
                              <span className="min-w-0 flex-1 truncate">
                                {displayValue(cellValue)}
                              </span>
                              {editable && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startEditing();
                                  }}
                                  aria-label={`Edit ${key} for feature ${index + 1}`}
                                  title="Edit this value"
                                  className="shrink-0 rounded p-0.5 text-primary opacity-60 hover:bg-accent lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                                >
                                  <Pencil className="size-3" />
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          try {
                            const bounds = turfBbox(f as never) as [number, number, number, number];
                            map?.fitBounds(bounds, { padding: 120, maxZoom: 17 });
                          } catch {
                            /* Invalid geometry. */
                          }
                        }}
                        aria-label="Zoom to feature"
                        title="Zoom the map to this feature"
                        className="rounded p-1 text-primary hover:bg-accent"
                      >
                        <Crosshair className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No rows match the current search and filters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FieldSelect({
  keys,
  value,
  setValue,
  label,
}: {
  keys: string[];
  value: string;
  setValue: (value: string) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => setValue(e.target.value)}
      aria-label={label}
      className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
    >
      <option value="">{label}</option>
      {keys.map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </select>
  );
}

function ValueInput({
  type,
  setType,
  value,
  setValue,
  placeholder,
}: {
  type: ValueType;
  setType: (type: ValueType) => void;
  value: string;
  setValue: (value: string) => void;
  placeholder: string;
}) {
  return (
    <>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as ValueType)}
        aria-label="Value type"
        className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
      >
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="boolean">True / false</option>
        <option value="null">Empty (NULL)</option>
      </select>
      {type === "boolean" ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={placeholder}
          className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : type !== "null" ? (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-36 rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
        />
      ) : null}
    </>
  );
}

function SortHeader({
  label,
  column,
  toggleSort,
  sortIcon,
}: {
  label: string;
  column: string;
  toggleSort: (column: string) => void;
  sortIcon: (column: string) => React.ReactNode;
}) {
  return (
    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
      <button
        onClick={() => toggleSort(column)}
        className="flex items-center gap-1"
        title={`Sort by ${label}`}
      >
        {label} {sortIcon(column)}
      </button>
    </th>
  );
}

function FilterToolbar({
  keys,
  field,
  setField,
  operator,
  setOperator,
  value,
  setValue,
  addFilter,
  selectResults,
  rowCount,
  editable,
  showAddField,
  setShowAddField,
  showBulkEdit,
  setShowBulkEdit,
  createFromResults,
}: {
  keys: string[];
  field: string;
  setField: (value: string) => void;
  operator: AttributeFilterOperator;
  setOperator: (value: AttributeFilterOperator) => void;
  value: string;
  setValue: (value: string) => void;
  addFilter: () => void;
  selectResults: () => void;
  rowCount: number;
  editable: boolean;
  showAddField: boolean;
  setShowAddField: (value: boolean) => void;
  showBulkEdit: boolean;
  setShowBulkEdit: (value: boolean) => void;
  createFromResults: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-secondary/40 px-3 py-2">
      <FieldSelect keys={keys} value={field} setValue={setField} label="Choose field" />
      <select
        value={operator}
        onChange={(e) => setOperator(e.target.value as AttributeFilterOperator)}
        aria-label="Attribute operator"
        className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
      >
        <option value="contains">contains</option>
        <option value="not_contains">does not contain</option>
        <option value="equals">equals</option>
        <option value="not_equals">does not equal</option>
        <option value="starts">starts with</option>
        <option value="ends">ends with</option>
        <option value="greater">is greater than</option>
        <option value="greater_equal">is at least</option>
        <option value="less">is less than</option>
        <option value="less_equal">is at most</option>
        <option value="empty">is empty</option>
        <option value="not_empty">is not empty</option>
      </select>
      {!VALUE_FREE_OPERATORS.has(operator) && (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addFilter();
          }}
          placeholder="Value"
          aria-label="Attribute value"
          className="w-36 rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
        />
      )}
      <button
        onClick={addFilter}
        className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs hover:bg-accent"
      >
        <Plus className="size-3.5" /> Add filter
      </button>
      <button
        onClick={selectResults}
        disabled={!rowCount}
        className="ml-auto flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        <CheckSquare className="size-3.5" /> Select {rowCount}
      </button>
      {editable && (
        <>
          <button
            onClick={() => {
              setShowAddField(!showAddField);
              setShowBulkEdit(false);
            }}
            className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs hover:bg-accent"
          >
            <Plus className="size-3.5" /> Add field
          </button>
          <button
            onClick={() => {
              setShowBulkEdit(!showBulkEdit);
              setShowAddField(false);
            }}
            disabled={!keys.length}
            className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <WandSparkles className="size-3.5" /> Bulk edit
          </button>
          <button
            onClick={createFromResults}
            disabled={!rowCount}
            className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            <CopyPlus className="size-3.5" /> New layer
          </button>
        </>
      )}
    </div>
  );
}
