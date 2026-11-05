export type PrintFeatureAttributeValue = string | number | boolean | null;

const isPrintableValue = (value: unknown): value is PrintFeatureAttributeValue =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

export const printableFeatureAttributes = (
  properties: Record<string, unknown> | null | undefined,
): Record<string, PrintFeatureAttributeValue> => {
  const attributes: Record<string, PrintFeatureAttributeValue> = {};
  for (const [key, value] of Object.entries(properties ?? {}))
    if (!key.startsWith("__") && isPrintableValue(value)) attributes[key] = value;
  return attributes;
};

const preferredFieldNames = [
  "name",
  "title",
  "label",
  "owner",
  "operator",
  "address",
  "type",
  "status",
  "id",
];

export const defaultFeatureCalloutFields = (
  attributes: Record<string, PrintFeatureAttributeValue>,
  limit = 4,
): string[] => {
  const populated = Object.keys(attributes).filter((key) => {
    const value = attributes[key];
    return value !== null && String(value).trim() !== "";
  });
  const rank = (field: string) => {
    const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
    const index = preferredFieldNames.findIndex(
      (candidate) => normalized === candidate || normalized.endsWith(candidate),
    );
    return index < 0 ? preferredFieldNames.length : index;
  };
  return populated
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, Math.max(0, limit));
};

export const featureCalloutLines = (
  title: string,
  attributes: Record<string, PrintFeatureAttributeValue> | undefined,
  fields: string[] | undefined,
): string[] => {
  const lines = title.trim() ? [title.trim()] : [];
  for (const field of fields ?? []) {
    const value = attributes?.[field];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    lines.push(`${field}: ${String(value)}`);
  }
  return lines;
};
