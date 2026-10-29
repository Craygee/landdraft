/** One malformed overlay must not prevent subsequent healthy layers from drawing. */
export function syncMapLayers<T extends { layer: { id: string } }>(
  entries: T[],
  sync: (entry: T) => void,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const entry of entries) {
    try {
      sync(entry);
    } catch (error) {
      errors[entry.layer.id] = error instanceof Error ? error.message : String(error);
    }
  }
  return errors;
}
