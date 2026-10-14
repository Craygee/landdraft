export type AttributeFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts"
  | "ends"
  | "greater"
  | "greater_equal"
  | "less"
  | "less_equal"
  | "empty"
  | "not_empty";

export interface AttributeFilter {
  id: string;
  field: string;
  operator: AttributeFilterOperator;
  value: string;
}

export type AttributeSortDirection = "asc" | "desc";

export interface AttributeRow<TFeature = unknown> {
  f: TFeature;
  index: number;
}

function compareNumbers(
  actual: unknown,
  wanted: string,
  compare: (a: number, b: number) => boolean,
) {
  const actualNumber = typeof actual === "number" ? actual : Number(actual);
  const wantedNumber = Number(wanted);
  return Number.isFinite(actualNumber) && Number.isFinite(wantedNumber)
    ? compare(actualNumber, wantedNumber)
    : false;
}

export function matchesAttributeFilter(
  properties: Record<string, unknown> | null | undefined,
  filter: AttributeFilter,
) {
  const actual = properties?.[filter.field];
  const empty = actual === null || actual === undefined || String(actual).trim() === "";
  if (filter.operator === "empty") return empty;
  if (filter.operator === "not_empty") return !empty;

  const actualText = String(actual ?? "").toLocaleLowerCase();
  const wanted = filter.value.toLocaleLowerCase();
  if (filter.operator === "equals") return actualText === wanted;
  if (filter.operator === "not_equals") return actualText !== wanted;
  if (filter.operator === "not_contains") return !actualText.includes(wanted);
  if (filter.operator === "starts") return actualText.startsWith(wanted);
  if (filter.operator === "ends") return actualText.endsWith(wanted);
  if (filter.operator === "greater") return compareNumbers(actual, filter.value, (a, b) => a > b);
  if (filter.operator === "greater_equal")
    return compareNumbers(actual, filter.value, (a, b) => a >= b);
  if (filter.operator === "less") return compareNumbers(actual, filter.value, (a, b) => a < b);
  if (filter.operator === "less_equal")
    return compareNumbers(actual, filter.value, (a, b) => a <= b);
  return actualText.includes(wanted);
}

export function compareAttributeValues(
  a: unknown,
  b: unknown,
  direction: AttributeSortDirection = "asc",
) {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const aNumber = typeof a === "number" ? a : Number(a);
  const bNumber = typeof b === "number" ? b : Number(b);
  const result =
    Number.isFinite(aNumber) && Number.isFinite(bNumber)
      ? aNumber - bNumber
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

export function parseAttributeValue(
  raw: string,
  type: "text" | "number" | "boolean" | "null",
): string | number | boolean | null {
  if (type === "null") return null;
  if (type === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error("Enter a valid number.");
    return parsed;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

export function parseEditedAttributeValue(raw: string, previous: unknown): unknown {
  if (raw === "" && typeof previous !== "string") return null;
  if (typeof previous === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error("This field contains numbers.");
    return parsed;
  }
  if (typeof previous === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") throw new Error("Enter true or false.");
    return normalized === "true";
  }
  if (previous && typeof previous === "object") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Enter valid JSON for this field.");
    }
  }
  return raw;
}

function tsvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return text.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

export function attributeRowsToTsv(
  rows: Array<{ index: number; properties: Record<string, unknown> | null | undefined }>,
  keys: string[],
) {
  return [
    ["Feature", ...keys].join("\t"),
    ...rows.map((row) =>
      [String(row.index + 1), ...keys.map((key) => tsvCell(row.properties?.[key]))].join("\t"),
    ),
  ].join("\n");
}
