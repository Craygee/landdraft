declare module "jsts" {
  import type { Geometry } from "geojson";
  export interface JGeometry {
    getArea(): number;
    isEmpty(): boolean;
    isValid(): boolean;
    getGeometryType(): string;
    getNumGeometries(): number;
    getGeometryN(n: number): JGeometry;
    intersection(other: JGeometry): JGeometry;
    difference(other: JGeometry): JGeometry;
    union(other: JGeometry): JGeometry;
    buffer(distance: number, quadrants?: number): JGeometry;
    getEnvelopeInternal(): {
      getMinX(): number;
      getMinY(): number;
      getMaxX(): number;
      getMaxY(): number;
    };
  }
  const jsts: {
    io: {
      GeoJSONReader: new () => { read(geometry: Geometry): JGeometry };
      GeoJSONWriter: new () => { write(geometry: JGeometry): Geometry };
    };
  };
  export default jsts;
}
