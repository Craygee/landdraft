// A map-image URL holds a placeholder the map fills in per tile. Sent as written, a
// publisher answers 400, which would report a working source as failed.
const SAMPLE_BBOX_EPSG_3857 = "-11062000,3650000,-11060000,3652000";

export const fillBboxPlaceholder = (url: string) =>
  url.replace(/\{bbox-epsg-3857\}/gi, SAMPLE_BBOX_EPSG_3857);
