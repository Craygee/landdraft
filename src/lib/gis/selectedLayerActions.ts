import type { FeatureCollection } from "geojson";
import type { GisLayer } from "./types.ts";
import { analyzeImportComplexity } from "./importBudget.ts";
import { combineStudyPolygons, localProjection, mapGeometry } from "./buildableArea.ts";
import { polygonBoundaryFeature } from "./buildableAreaModel.ts";
import jsts from "jsts";

export type SelectionLayer = Pick<GisLayer, "id" | "name" | "data">;
export interface SelectionArea {
  acres: number;
  polygonFeatures: number;
  ignoredFeatures: number;
  layerNames: string[];
}
export function selectionCollection(
  layers: SelectionLayer[],
  allowEmpty = false,
): FeatureCollection {
  if (!layers.length) throw new Error("Select at least one layer.");
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: layers.flatMap((l) => l.data.features),
  };
  analyzeImportComplexity("Selected layers", data);
  if (!allowEmpty && !data.features.length)
    throw new Error("The selected layers contain no loaded features.");
  return data;
}
/** Preserve individual geometries and attributes; this is a merge, not a dissolve. */
export function combineSelectedLayers(layers: SelectionLayer[]): FeatureCollection {
  selectionCollection(layers);
  return {
    type: "FeatureCollection",
    features: layers.flatMap((layer) =>
      layer.data.features.map((feature, index) => {
        const copy = structuredClone(feature);
        const properties = copy.properties ?? {};
        let key = "__landdraftSource";
        while (Object.prototype.hasOwnProperty.call(properties, key)) key += "_";
        properties[key] = {
          layerId: layer.id,
          layerName: layer.name,
          featureId: feature.id ?? null,
        };
        return { ...copy, id: `${layer.id}:${index}`, properties };
      }),
    ),
  };
}
/** Local projected metres, polygon union, holes preserved, overlaps counted once. */
export function measureSelectedLayers(layers: SelectionLayer[]): SelectionArea {
  const data = selectionCollection(layers);
  const polygons = data.features.flatMap((f) => {
    const polygon = polygonBoundaryFeature(f);
    return polygon ? [polygon] : [];
  });
  if (!polygons.length)
    throw new Error(
      "No polygon areas are loaded in these layers. Lines and points have no acreage.",
    );
  const union = combineStudyPolygons(polygons);
  const projection = localProjection(union.geometry);
  const geometry = new jsts.io.GeoJSONReader().read(
    mapGeometry(union.geometry, projection.forward),
  );
  return {
    acres: geometry.getArea() / 4046.8564224,
    polygonFeatures: polygons.length,
    ignoredFeatures: data.features.length - polygons.length,
    layerNames: layers.map((l) => l.name),
  };
}
