import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, Geometry, Position } from "geojson";
import { GeoJSONSource, Marker } from "maplibre-gl";
import {
  Car,
  ChevronDown,
  CircleStop,
  Copy,
  Crosshair,
  Footprints,
  Gauge,
  Hexagon,
  LocateFixed,
  Loader2,
  MapPinned,
  Navigation,
  Pause,
  Play,
  Route,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { catalog } from "@/lib/gis/catalog";
import { resolveCatalogUrl } from "@/lib/gis/connectionHealth";
import { formatLength, squareMeters } from "@/lib/gis/measure";
import { directionsUrl, type NavigationActivity } from "@/lib/gis/directions";
import { cn } from "@/lib/utils";

type Activity = NavigationActivity;
type TrackKind = "path" | "area";
type GpsStatus = "idle" | "requesting" | "active" | "error" | "denied";

interface FieldLocation {
  lng: number;
  lat: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

interface TrackSession {
  kind: TrackKind;
  activity: Activity;
  startedAt: number;
  paused: boolean;
}

interface PendingCapture {
  kind: "point" | TrackKind;
  geometry: Geometry;
  properties: Record<string, unknown>;
  suggestedName: string;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

const FIELD_PREVIEW_SOURCE = "landdraft-field-preview";
const FIELD_PREVIEW_FILL = "landdraft-field-preview-fill";
const FIELD_PREVIEW_LINE = "landdraft-field-preview-line";
const PARCEL_FIELDS = [
  "OBJECTID",
  "Prop_ID",
  "GEO_ID",
  "OWNER_NAME",
  "LEGAL_AREA",
  "GIS_AREA",
  "LEGAL_DESC",
  "SITUS_ADDR",
  "MAIL_ADDR",
];
const MARKER_OPTIONS = [
  { symbol: "●", label: "Dot" },
  { symbol: "◆", label: "Diamond" },
  { symbol: "★", label: "Star" },
  { symbol: "▲", label: "Direction" },
] as const;

const rad = (value: number) => (value * Math.PI) / 180;
const segmentMeters = (a: Position, b: Position) => {
  const lat1 = rad(Number(a[1]));
  const lat2 = rad(Number(b[1]));
  const dLat = lat2 - lat1;
  const dLng = rad(Number(b[0]) - Number(a[0]));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const featureDestination = (geometry: Geometry): [number, number] | null => {
  if (geometry.type === "Point")
    return [Number(geometry.coordinates[0]), Number(geometry.coordinates[1])];
  const coordinates: Position[] = [];
  const collect = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      coordinates.push(value as Position);
      return;
    }
    if (Array.isArray(value)) value.forEach(collect);
  };
  collect("coordinates" in geometry ? geometry.coordinates : []);
  if (!coordinates.length) return null;
  const bounds = coordinates.reduce(
    (current, coordinate) => ({
      minX: Math.min(current.minX, Number(coordinate[0])),
      minY: Math.min(current.minY, Number(coordinate[1])),
      maxX: Math.max(current.maxX, Number(coordinate[0])),
      maxY: Math.max(current.maxY, Number(coordinate[1])),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
};

const captureName = (prefix: string) =>
  `${prefix} · ${new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;

const locationFromPosition = (position: GeolocationPosition): FieldLocation | null => {
  const lng = Number(position.coords.longitude);
  const lat = Number(position.coords.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const optionalNumber = (value: number | null) =>
    value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
  const accuracy = Number(position.coords.accuracy);
  const timestamp = Number(position.timestamp);
  return {
    lng,
    lat,
    accuracy: Number.isFinite(accuracy) ? Math.max(0, accuracy) : 999,
    altitude: optionalNumber(position.coords.altitude),
    speed: optionalNumber(position.coords.speed),
    heading: optionalNumber(position.coords.heading),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
};

export function FieldModule({ active = true }: { active?: boolean }) {
  const wb = useWorkbench();
  const { map } = useMapRef();
  const wbRef = useRef(wb);
  wbRef.current = wb;
  const markerRef = useRef<Marker | null>(null);
  const pendingMarkerRef = useRef<Marker | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const mapInstanceRef = useRef(map);
  mapInstanceRef.current = map;
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const trackRef = useRef<TrackSession | null>(null);
  const pointsRef = useRef<Position[]>([]);
  const distanceRef = useRef(0);
  const lastAcceptedAtRef = useRef(0);
  const locationErrorShown = useRef(false);
  const [activity, setActivity] = useState<Activity>("walking");
  const [location, setLocation] = useState<FieldLocation | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const [track, setTrackState] = useState<TrackSession | null>(null);
  const [trackPoints, setTrackPoints] = useState<Position[]>([]);
  const [trackDistance, setTrackDistance] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [captureNameValue, setCaptureNameValue] = useState("");
  const [captureNotes, setCaptureNotes] = useState("");
  const [attributesOpen, setAttributesOpen] = useState(false);

  const parcelLayer = wb.layers.find(
    (layer) => layer.source.kind === "remote" && layer.source.catalogId === "tx-parcels",
  );
  const selected = useMemo(() => {
    const selectedFeature = wb.selectedFeatures[0];
    if (!selectedFeature) return null;
    const layer = wb.displayLayers.find((item) => item.id === selectedFeature.layerId);
    const feature = layer?.data.features[selectedFeature.index];
    return layer && feature ? { layer, feature } : null;
  }, [wb.displayLayers, wb.selectedFeatures]);

  const setTrack = (value: TrackSession | null) => {
    trackRef.current = value;
    setTrackState(value);
  };

  const requestWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // Tracking still works when a browser or power-saving mode rejects the optional wake lock.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) void lock.release();
  }, []);

  const updateLocation = useCallback((position: GeolocationPosition) => {
    const next = locationFromPosition(position);
    if (!next) {
      setGpsStatus("error");
      setGpsMessage("The device returned an invalid location. Try again outdoors.");
      return;
    }
    locationErrorShown.current = false;
    setGpsStatus("active");
    setGpsMessage("");
    setLocation(next);
    const currentMap = mapInstanceRef.current;
    if (currentMap && followRef.current && activeRef.current) {
      try {
        currentMap.easeTo({
          center: [next.lng, next.lat],
          zoom: Math.max(currentMap.getZoom(), 16),
          duration: 500,
        });
      } catch (error) {
        console.warn("[field] Map could not center on the GPS fix", error);
      }
    }
    const session = trackRef.current;
    if (!session || session.paused || next.accuracy > 80) return;
    const coordinate: Position = [next.lng, next.lat];
    const previous = pointsRef.current[pointsRef.current.length - 1];
    if (!previous) {
      pointsRef.current = [coordinate];
      lastAcceptedAtRef.current = next.timestamp;
      setTrackPoints([coordinate]);
      return;
    }
    const step = segmentMeters(previous, coordinate);
    const elapsed = Math.max(1, (next.timestamp - lastAcceptedAtRef.current) / 1000);
    const minimumStep = session.activity === "walking" ? 2 : 7;
    const maximumSpeed = session.activity === "walking" ? 12 : 75;
    if (step < minimumStep || step / elapsed > maximumSpeed) return;
    distanceRef.current += step;
    lastAcceptedAtRef.current = next.timestamp;
    const points = [...pointsRef.current, coordinate];
    pointsRef.current = points;
    setTrackPoints(points);
    setTrackDistance(distanceRef.current);
  }, []);

  const ensureWatch = useCallback(
    (restart = false) => {
      if (restart && watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (watchIdRef.current !== null) return true;
      if (!navigator.geolocation) {
        toast.error("Location is not available in this browser");
        setGpsStatus("error");
        setGpsMessage("This browser does not provide device location.");
        return false;
      }
      if (!window.isSecureContext) {
        toast.error("GPS requires a secure connection");
        setGpsStatus("error");
        setGpsMessage("Open LandDraft using its secure https address and try again.");
        return false;
      }
      setGpsStatus("requesting");
      setGpsMessage("Finding your location…");
      locationErrorShown.current = false;
      const startWatch = (highAccuracy: boolean): void => {
        try {
          const watchId = navigator.geolocation.watchPosition(
            updateLocation,
            (error) => {
              if (watchIdRef.current !== watchId) return;
              navigator.geolocation.clearWatch(watchId);
              watchIdRef.current = null;
              if (highAccuracy && error.code !== 1) {
                setGpsMessage("Trying a faster location fix…");
                startWatch(false);
                return;
              }
              const denied = error.code === 1;
              const message = denied
                ? "Location is blocked. Allow Location for this website in browser settings, then retry."
                : error.code === 2
                  ? "A location fix is unavailable. Turn on device Location Services or move outdoors, then retry."
                  : "The location request timed out. Check Location Services and try again.";
              setLocation(null);
              setGpsStatus(denied ? "denied" : "error");
              setGpsMessage(message);
              if (!locationErrorShown.current) {
                toast.error(denied ? "Location permission is blocked" : "GPS is not ready", {
                  description: message,
                });
                locationErrorShown.current = true;
              }
            },
            {
              enableHighAccuracy: highAccuracy,
              maximumAge: highAccuracy ? 2_000 : 30_000,
              timeout: highAccuracy ? 18_000 : 12_000,
            },
          );
          watchIdRef.current = watchId;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Location could not be started";
          setGpsStatus("error");
          setGpsMessage(message);
          toast.error("GPS could not start", { description: message });
        }
      };
      startWatch(true);
      return true;
    },
    [updateLocation],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(
    () => () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      markerRef.current?.remove();
      markerRef.current = null;
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
      releaseWakeLock();
    },
    [releaseWakeLock],
  );

  useEffect(() => {
    const restoreWakeLock = () => {
      if (document.visibilityState === "visible" && trackRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", restoreWakeLock);
    return () => document.removeEventListener("visibilitychange", restoreWakeLock);
  }, [requestWakeLock]);

  useEffect(() => {
    if (active || trackRef.current || watchIdRef.current === null) return;
    navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, [active]);

  useEffect(() => {
    if (!map) return;
    if (!location) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    try {
      if (!markerRef.current) {
        const element = document.createElement("div");
        element.className = "field-location-dot";
        element.title = "Current GPS location";
        markerRef.current = new Marker({ element, anchor: "center" })
          .setLngLat([location.lng, location.lat])
          .addTo(map);
      } else {
        markerRef.current.setLngLat([location.lng, location.lat]);
      }
    } catch (error) {
      markerRef.current?.remove();
      markerRef.current = null;
      console.warn("[field] Current-location marker could not be displayed", error);
    }
  }, [location, map]);

  useEffect(() => {
    if (!map || !active) return;
    const stopFollowing = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) {
        followRef.current = false;
        setFollow(false);
      }
    };
    map.on("dragstart", stopFollowing);
    map.on("zoomstart", stopFollowing);
    map.on("rotatestart", stopFollowing);
    return () => {
      map.off("dragstart", stopFollowing);
      map.off("zoomstart", stopFollowing);
      map.off("rotatestart", stopFollowing);
    };
  }, [active, map]);

  useEffect(() => {
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = null;
    if (!map || pending?.kind !== "point" || pending.geometry.type !== "Point") return;
    const [lng, lat] = pending.geometry.coordinates;
    if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return;
    const element = document.createElement("div");
    element.className = "field-pending-marker";
    element.textContent = String(pending.properties["MARKER_ICON"] ?? MARKER_OPTIONS[0].symbol);
    element.title = captureNameValue || pending.suggestedName;
    try {
      pendingMarkerRef.current = new Marker({ element, anchor: "center" })
        .setLngLat([Number(lng), Number(lat)])
        .addTo(map);
    } catch (error) {
      pendingMarkerRef.current = null;
      console.warn("[field] Pending marker could not be displayed", error);
    }
    return () => {
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
    };
  }, [captureNameValue, map, pending]);

  useEffect(() => {
    if (!map) return;
    const drawPreview = () => {
      try {
        if (!map.isStyleLoaded()) return;
        const geometry: Geometry =
          track?.kind === "area" && trackPoints.length >= 3
            ? { type: "Polygon", coordinates: [[...trackPoints, trackPoints[0]!]] }
            : { type: "LineString", coordinates: trackPoints };
        const data = {
          type: "FeatureCollection" as const,
          features: trackPoints.length
            ? [{ type: "Feature" as const, properties: {}, geometry }]
            : [],
        };
        const source = map.getSource(FIELD_PREVIEW_SOURCE) as GeoJSONSource | undefined;
        if (source) source.setData(data);
        else map.addSource(FIELD_PREVIEW_SOURCE, { type: "geojson", data });
        if (!map.getLayer(FIELD_PREVIEW_FILL))
          map.addLayer({
            id: FIELD_PREVIEW_FILL,
            type: "fill",
            source: FIELD_PREVIEW_SOURCE,
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": "#f2b73d", "fill-opacity": 0.22 },
          });
        if (!map.getLayer(FIELD_PREVIEW_LINE))
          map.addLayer({
            id: FIELD_PREVIEW_LINE,
            type: "line",
            source: FIELD_PREVIEW_SOURCE,
            paint: { "line-color": "#f2b73d", "line-width": 5, "line-opacity": 0.95 },
          });
      } catch (error) {
        console.warn("[field] Track preview could not be refreshed", error);
      }
    };
    drawPreview();
    map.on("styledata", drawPreview);
    return () => {
      map.off("styledata", drawPreview);
    };
  }, [map, track?.kind, trackPoints]);

  const locate = () => {
    followRef.current = true;
    setFollow(true);
    if (!ensureWatch(gpsStatus === "error" || gpsStatus === "denied")) return;
    if (location && map) {
      try {
        map.easeTo({ center: [location.lng, location.lat], zoom: Math.max(map.getZoom(), 16) });
      } catch (error) {
        console.warn("[field] Map could not center on the saved GPS fix", error);
      }
    }
  };

  const startTrack = (kind: TrackKind) => {
    if (!wb.canEditProject) {
      toast.error("This shared map is view only");
      return;
    }
    const session = { kind, activity, startedAt: Date.now(), paused: false };
    pointsRef.current = [];
    distanceRef.current = 0;
    lastAcceptedAtRef.current = 0;
    setTrackPoints([]);
    setTrackDistance(0);
    setTrack(session);
    followRef.current = true;
    setFollow(true);
    void requestWakeLock();
    if (!ensureWatch()) {
      setTrack(null);
      releaseWakeLock();
    }
  };

  const quickMark = () => {
    if (!wb.canEditProject) {
      toast.error("This shared map is view only");
      return;
    }
    const sample = location;
    if (!sample) {
      ensureWatch();
      toast.info("Waiting for a GPS fix", {
        description: "Keep tracking. Quick mark will be ready as soon as your location appears.",
      });
      return;
    }
    const current = wbRef.current;
    const session = trackRef.current;
    const groupId =
      current.groups.find((group) => group.name.toLowerCase() === "field collection")?.id ??
      current.addGroup("Field collection");
    const layerName = "Field GPS points";
    const feature: Feature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [sample.lng, sample.lat],
      },
      properties: {
        NAME: captureName("Quick mark"),
        LAT: Number(sample.lat.toFixed(7)),
        LON: Number(sample.lng.toFixed(7)),
        ACCURACY_M: Math.round(sample.accuracy),
        ALTITUDE_M: sample.altitude === null ? null : Number(sample.altitude.toFixed(1)),
        MARKER_ICON: MARKER_OPTIONS[1].symbol,
        ACTIVITY: session?.activity ?? activity,
        TRACK_KIND: session?.kind ?? null,
        CAPTURED: new Date().toISOString(),
        FIELD_SOURCE: "Quick mark during GPS track",
      },
    };
    const existing = current.layers.find(
      (layer) => layer.groupId === groupId && layer.name === layerName,
    );
    if (existing) {
      current.appendFeature(existing.id, feature);
    } else {
      current.addLayer({
        name: layerName,
        data: { type: "FeatureCollection", features: [feature] },
        groupId,
        source: { kind: "draw" },
        style: {
          fillColor: "#f2b73d",
          strokeColor: "#1e6f43",
          pointSize: 8,
          labelEnabled: true,
          labelTemplate: "{NAME}",
          labelFields: ["NAME"],
          labelMinZoom: 14,
        },
      });
    }
    toast.success("Quick mark dropped", {
      description: "Tracking is still running. Tap the marker later to add details.",
    });
    window.setTimeout(() => void wbRef.current.saveProject("manual"), 300);
  };

  const stopTrack = () => {
    const session = trackRef.current;
    const points = pointsRef.current;
    if (!session) return;
    if (points.length < (session.kind === "area" ? 3 : 2)) {
      toast.error(
        session.kind === "area"
          ? "Keep moving until at least three GPS positions are recorded"
          : "Keep moving until at least two GPS positions are recorded",
      );
      return;
    }
    const geometry: Geometry =
      session.kind === "area"
        ? { type: "Polygon", coordinates: [[...points, points[0]!]] }
        : { type: "LineString", coordinates: points };
    const areaSquareMeters = squareMeters({ type: "Feature", properties: {}, geometry });
    const durationSeconds = Math.round((Date.now() - session.startedAt) / 1_000);
    const prefix = session.kind === "area" ? "Field area" : "Field path";
    setPending({
      kind: session.kind,
      geometry,
      suggestedName: captureName(prefix),
      properties: {
        ACTIVITY: session.activity,
        DISTANCE_M: Number(distanceRef.current.toFixed(1)),
        DISTANCE_MI: Number((distanceRef.current / 1609.344).toFixed(3)),
        DURATION_SEC: durationSeconds,
        GPS_POINTS: points.length,
        ...(session.kind === "area"
          ? {
              AREA_ACRES: Number((areaSquareMeters / 4046.8564224).toFixed(3)),
              AREA_SQ_FT: Math.round(areaSquareMeters * 10.7639104167),
            }
          : {}),
        CAPTURED: new Date().toISOString(),
        FIELD_SOURCE: "GPS track",
      },
    });
    setCaptureNameValue(captureName(prefix));
    setCaptureNotes("");
    setTrack(null);
    setTrackPoints([]);
    releaseWakeLock();
  };

  const capturePoint = () => {
    if (!wb.canEditProject) {
      toast.error("This shared map is view only");
      return;
    }
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser");
      return;
    }
    const stagePoint = (sample: FieldLocation) => {
      const suggestedName = captureName("Field point");
      setPending({
        kind: "point",
        geometry: {
          type: "Point",
          coordinates: [sample.lng, sample.lat],
        },
        suggestedName,
        properties: {
          LAT: Number(sample.lat.toFixed(7)),
          LON: Number(sample.lng.toFixed(7)),
          ACCURACY_M: Math.round(sample.accuracy),
          ALTITUDE_M: sample.altitude === null ? null : Number(sample.altitude.toFixed(1)),
          MARKER_ICON: MARKER_OPTIONS[0].symbol,
          CAPTURED: new Date().toISOString(),
          FIELD_SOURCE: "GPS point",
        },
      });
      setCaptureNameValue(suggestedName);
      setCaptureNotes("");
      toast.success("GPS point ready", {
        description: `Accuracy ±${Math.round(sample.accuracy)} m. Add a name or note, then save.`,
      });
    };
    const stagePosition = (position: GeolocationPosition) => {
      const sample = locationFromPosition(position);
      if (!sample) {
        setGpsStatus("error");
        setGpsMessage("The device returned an invalid location. Try again outdoors.");
        toast.error("A GPS point could not be captured");
        return;
      }
      updateLocation(position);
      stagePoint(sample);
    };
    const failPoint = (error: GeolocationPositionError) => {
      const message =
        error.code === 1
          ? "Allow Location for this website in browser settings, then retry."
          : "Turn on device Location Services or move outdoors, then retry.";
      setGpsStatus(error.code === 1 ? "denied" : "error");
      setGpsMessage(message);
      toast.error("A GPS point could not be captured", { description: message });
    };
    if (location && Date.now() - location.timestamp <= 60_000 && location.accuracy <= 100) {
      stagePoint(location);
      return;
    }
    setGpsStatus("requesting");
    setGpsMessage("Finding an accurate point…");
    try {
      navigator.geolocation.getCurrentPosition(
        stagePosition,
        (error) => {
          if (error.code === 1) {
            failPoint(error);
            return;
          }
          setGpsMessage("Trying a faster location fix…");
          try {
            navigator.geolocation.getCurrentPosition(stagePosition, failPoint, {
              enableHighAccuracy: false,
              maximumAge: 30_000,
              timeout: 12_000,
            });
          } catch (caught) {
            const message = caught instanceof Error ? caught.message : "Location is unavailable";
            setGpsStatus("error");
            setGpsMessage(message);
            toast.error("A GPS point could not be captured", { description: message });
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 2_000,
          timeout: 18_000,
        },
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Location is unavailable";
      setGpsStatus("error");
      setGpsMessage(message);
      toast.error("A GPS point could not be captured", { description: message });
    }
  };

  const saveCapture = () => {
    if (!pending) return;
    const current = wbRef.current;
    const groupId =
      current.groups.find((group) => group.name.toLowerCase() === "field collection")?.id ??
      current.addGroup("Field collection");
    const layerName =
      pending.kind === "point"
        ? "Field GPS points"
        : pending.kind === "path"
          ? "Field paths"
          : "Field areas";
    const feature: Feature = {
      type: "Feature",
      geometry: pending.geometry,
      properties: {
        ...pending.properties,
        NAME: captureNameValue.trim() || pending.suggestedName,
        ...(captureNotes.trim() ? { NOTES: captureNotes.trim() } : {}),
      },
    };
    const existing = current.layers.find(
      (layer) => layer.groupId === groupId && layer.name === layerName,
    );
    let selectedLayerId: string;
    let selectedIndex: number;
    if (existing) {
      selectedLayerId = existing.id;
      selectedIndex = existing.data.features.length;
      current.appendFeature(existing.id, feature);
      current.setActiveLayer(existing.id);
    } else {
      const created = current.addLayer({
        name: layerName,
        data: { type: "FeatureCollection", features: [feature] },
        groupId,
        source: { kind: "draw" },
        style:
          pending.kind === "point"
            ? {
                fillColor: "#f2b73d",
                strokeColor: "#1e6f43",
                pointSize: 8,
                labelEnabled: true,
                labelTemplate: "{NAME}",
                labelFields: ["NAME"],
                labelMinZoom: 14,
              }
            : pending.kind === "path"
              ? { fillOpacity: 0, strokeColor: "#f2b73d", strokeWidth: 4 }
              : {
                  fillColor: "#f2b73d",
                  fillOpacity: 0.2,
                  strokeColor: "#1e6f43",
                  strokeWidth: 3,
                  labelEnabled: true,
                  labelTemplate: "{NAME}",
                  labelFields: ["NAME"],
                  labelMinZoom: 13,
                },
      });
      selectedLayerId = created.id;
      selectedIndex = 0;
    }
    current.setSelectedFeatures([{ layerId: selectedLayerId, index: selectedIndex }]);
    setPending(null);
    toast.success(`${layerName} saved to ${current.projectName}`);
    window.setTimeout(() => void wbRef.current.saveProject("manual"), 300);
  };

  const toggleParcels = () => {
    const current = wbRef.current;
    const entry = catalog.find((item) => item.id === "tx-parcels");
    if (!entry) return;
    const url =
      (current.connectionHints["catalog:tx-parcels"]?.verified
        ? current.connectionHints["catalog:tx-parcels"]?.url
        : undefined) ?? resolveCatalogUrl(entry);
    if (!url) {
      toast.error("The parcel connection is not available");
      return;
    }
    if (parcelLayer) {
      if (parcelLayer.source.kind !== "remote") return;
      const needsRetry =
        parcelLayer.source.loadStatus === "error" ||
        parcelLayer.source.loadStatus === "zoom-in" ||
        (parcelLayer.visible &&
          !parcelLayer.source.loading &&
          parcelLayer.data.features.length === 0);
      const willShow = needsRetry || !parcelLayer.visible;
      current.updateLayer(parcelLayer.id, {
        visible: willShow,
        ...(needsRetry ? { data: { type: "FeatureCollection", features: [] } } : {}),
        source: {
          ...parcelLayer.source,
          url,
          requiresViewport: true,
          minZoom: 13,
          outFields: PARCEL_FIELDS,
          ...(needsRetry
            ? {
                refreshToken: Date.now(),
                loading: false,
                loadStatus: "idle" as const,
                loadedFeatures: 0,
              }
            : {}),
        },
      });
      current.updateStyle(parcelLayer.id, {
        fillOpacity: 0,
        strokeColor: "#2f7d4f",
        strokeWidth: 1.5,
        labelEnabled: true,
        labelTemplate: "{OWNER_NAME}",
        labelFields: ["OWNER_NAME"],
        labelMinZoom: 14,
        labelMaxZoom: 24,
      });
      if (willShow && map && map.getZoom() < 14) map.easeTo({ zoom: 14 });
      else if (parcelLayer.source.loadStatus === "zoom-in" && map)
        map.easeTo({ zoom: Math.min(19, map.getZoom() + 1) });
      if (needsRetry) {
        toast.info("Retrying parcels for this map area", {
          description: "Nearby parcel outlines will appear as each page arrives.",
        });
      }
      return;
    }
    current.addLayer({
      name: entry.name,
      data: { type: "FeatureCollection", features: [] },
      groupId: "public",
      source: {
        kind: "remote",
        url,
        catalogId: entry.id,
        attribution: entry.agency,
        requiresViewport: true,
        minZoom: 13,
        outFields: PARCEL_FIELDS,
      },
      style: {
        fillOpacity: 0,
        strokeColor: "#2f7d4f",
        strokeWidth: 1.5,
        labelEnabled: true,
        labelTemplate: "{OWNER_NAME}",
        labelFields: ["OWNER_NAME"],
        labelMinZoom: 14,
        labelMaxZoom: 24,
      },
    });
    if (map && map.getZoom() < 14) map.easeTo({ zoom: 14 });
    toast.success("Parcels enabled", {
      description: "Owner labels appear at close zoom. Tap a parcel for its attributes.",
    });
  };

  const openDirections = (feature: Feature, direction: "to" | "from" = "to") => {
    const destination = featureDestination(feature.geometry);
    if (!destination) return;
    const [lng, lat] = destination;
    window.location.assign(directionsUrl(lat, lng, direction, activity));
  };

  const copyCoordinates = async (feature: Feature) => {
    const coordinate = featureDestination(feature.geometry);
    if (!coordinate) return;
    const [lng, lat] = coordinate;
    try {
      await navigator.clipboard.writeText(`${lat.toFixed(7)}, ${lng.toFixed(7)}`);
      toast.success("Marker coordinates copied");
    } catch {
      toast.error("Coordinates could not be copied");
    }
  };

  const accuracyTone = !location
    ? gpsStatus === "error" || gpsStatus === "denied"
      ? "text-red-700"
      : gpsStatus === "requesting"
        ? "text-amber-700"
        : "text-muted-foreground"
    : location.accuracy <= 10
      ? "text-emerald-700"
      : location.accuracy <= 30
        ? "text-amber-700"
        : "text-red-700";
  const selectedProperties = Object.entries(selected?.feature.properties ?? {}).filter(
    ([key]) => !key.startsWith("__"),
  );
  const selectedName = selected
    ? String(
        selected.feature.properties?.["OWNER_NAME"] ??
          selected.feature.properties?.["NAME"] ??
          selected.layer.name,
      )
    : "";
  const parcelSource = parcelLayer?.source.kind === "remote" ? parcelLayer.source : null;
  const parcelLoading = Boolean(parcelLayer?.visible && parcelSource?.loading);
  const parcelNeedsZoom = parcelSource?.loadStatus === "zoom-in";
  const parcelNeedsRetry = parcelSource?.loadStatus === "error";

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] z-20 flex items-start gap-2",
          gpsStatus === "active" ? "justify-end" : "justify-between",
        )}
      >
        {gpsStatus !== "active" && (
          <button
            onClick={locate}
            aria-label="Enable device GPS location"
            title={gpsMessage || "Use this device’s current location"}
            className="float-surface pointer-events-auto flex max-w-[13rem] items-center gap-2 rounded-2xl px-3 py-2 text-left"
          >
            {gpsStatus === "requesting" ? (
              <Loader2 className={cn("size-4 shrink-0 animate-spin", accuracyTone)} />
            ) : (
              <Gauge className={cn("size-4 shrink-0", accuracyTone)} />
            )}
            <span className="min-w-0">
              <strong className="block text-[11px]">
                {gpsStatus === "requesting"
                  ? "Locating…"
                  : gpsStatus === "error" || gpsStatus === "denied"
                    ? "Retry GPS"
                    : "Enable GPS"}
              </strong>
              <span className="block truncate text-[9px] text-muted-foreground">
                {gpsMessage || "Tap to locate"}
              </span>
            </span>
          </button>
        )}
        <button
          onClick={toggleParcels}
          aria-pressed={Boolean(parcelLayer?.visible)}
          title={parcelSource?.loadError || "Show or hide nearby parcel boundaries"}
          className={cn(
            "float-surface pointer-events-auto flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold",
            parcelLayer?.visible && "bg-primary text-primary-foreground",
          )}
        >
          {parcelLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPinned className="size-4" />
          )}{" "}
          {parcelNeedsZoom
            ? "Zoom in"
            : parcelNeedsRetry
              ? "Retry parcels"
              : parcelLoading
                ? "Loading…"
                : "Parcels"}
        </button>
      </div>

      {selected && (
        <section className="field-selection-card panel-surface pointer-events-auto absolute left-3 right-3 top-[calc(8.5rem+env(safe-area-inset-top))] z-30 overflow-y-auto rounded-2xl p-3 shadow-float">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{selectedName}</p>
              <p className="text-[10px] text-muted-foreground">{selected.layer.name}</p>
            </div>
            <button
              onClick={() => wb.setSelectedFeatures([])}
              aria-label="Close selected feature"
              className="rounded-lg p-2 hover:bg-accent"
            >
              <X className="size-4" />
            </button>
          </div>
          <div
            className={cn(
              "mt-2 grid gap-2",
              selected.feature.geometry.type === "Point" ? "grid-cols-3" : "grid-cols-1",
            )}
          >
            <button
              type="button"
              onClick={() => openDirections(selected.feature)}
              className="flex items-center justify-center gap-1 rounded-xl bg-primary px-2 py-2 text-[10px] font-semibold text-primary-foreground"
            >
              <Navigation className="size-3.5" /> Directions
            </button>
            {selected.feature.geometry.type === "Point" && (
              <>
                <button
                  type="button"
                  onClick={() => openDirections(selected.feature, "from")}
                  className="flex items-center justify-center gap-1 rounded-xl bg-secondary px-2 py-2 text-[10px] font-semibold"
                >
                  <Route className="size-3.5" /> Start here
                </button>
                <button
                  type="button"
                  onClick={() => void copyCoordinates(selected.feature)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-secondary px-2 py-2 text-[10px] font-semibold"
                >
                  <Copy className="size-3.5" /> Copy GPS
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => setAttributesOpen((value) => !value)}
            className="mt-2 flex w-full items-center justify-between rounded-xl bg-secondary px-3 py-2 text-[10px] font-semibold"
          >
            View attributes
            <ChevronDown
              className={cn("size-3.5 transition-transform", attributesOpen && "rotate-180")}
            />
          </button>
          {attributesOpen && (
            <dl className="mt-2 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-[10px]">
              {selectedProperties.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="truncate font-semibold text-muted-foreground">{key}</dt>
                  <dd className="break-words">{String(value ?? "")}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      <section className="field-action-dock panel-surface pointer-events-auto absolute inset-x-2 bottom-[max(.5rem,env(safe-area-inset-bottom))] z-30 rounded-3xl p-2 shadow-float">
        {track ? (
          <div className="space-y-2 p-1">
            <div className="flex items-center gap-3 rounded-2xl bg-secondary px-3 py-2">
              <span className="relative flex size-3">
                {!track.paused && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
                )}
                <span className="relative inline-flex size-3 rounded-full bg-red-600" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">
                  Recording {track.kind === "area" ? "area boundary" : "path"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatLength(trackDistance, wb.units.length)} ·{" "}
                  {Math.max(0, Math.round((clock - track.startedAt) / 1000))} sec ·{" "}
                  {trackPoints.length} GPS points
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const next = { ...track, paused: !track.paused };
                  setTrack(next);
                }}
                className="flex items-center justify-center gap-1 rounded-2xl bg-secondary px-1 py-3 text-[10px] font-semibold"
              >
                {track.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                {track.paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={quickMark}
                title="Drop a GPS point without stopping this track"
                className="flex items-center justify-center gap-1 rounded-2xl bg-primary px-1 py-3 text-[10px] font-semibold text-primary-foreground"
              >
                <MapPinned className="size-4" /> Quick mark
              </button>
              <button
                type="button"
                onClick={stopTrack}
                title="Finish and review this track"
                className="flex items-center justify-center gap-1 rounded-2xl bg-red-600 px-1 py-3 text-[10px] font-semibold text-white"
              >
                <CircleStop className="size-4" /> Finish
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="grid flex-1 grid-cols-2 rounded-xl bg-secondary p-1">
                <button
                  onClick={() => setActivity("walking")}
                  className={cn(
                    "flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold",
                    activity === "walking" && "bg-card shadow-sm",
                  )}
                >
                  <Footprints className="size-3.5" /> Walk
                </button>
                <button
                  onClick={() => setActivity("driving")}
                  className={cn(
                    "flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold",
                    activity === "driving" && "bg-card shadow-sm",
                  )}
                >
                  <Car className="size-3.5" /> Drive
                </button>
              </div>
              <button
                onClick={() => {
                  if (follow) {
                    followRef.current = false;
                    setFollow(false);
                  } else locate();
                }}
                aria-pressed={follow}
                className={cn(
                  "flex items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-semibold",
                  follow ? "bg-primary text-primary-foreground" : "bg-secondary",
                )}
              >
                <Crosshair className="size-3.5" /> Follow
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <FieldAction icon={<LocateFixed />} label="Locate" onClick={locate} />
              <FieldAction icon={<MapPinned />} label="Mark" onClick={capturePoint} />
              <FieldAction icon={<Route />} label="Track path" onClick={() => startTrack("path")} />
              <FieldAction
                icon={<Hexagon />}
                label="Track area"
                onClick={() => startTrack("area")}
              />
            </div>
          </>
        )}
      </section>

      {pending && (
        <div className="fixed inset-0 z-[80] flex items-end bg-foreground/25 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] backdrop-blur-[2px]">
          <section className="field-capture-sheet w-full rounded-3xl border border-border bg-card p-4 shadow-float">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Save field capture</h2>
                <p className="text-[10px] text-muted-foreground">
                  It will sync with this project and open in the full map.
                </p>
              </div>
              <button onClick={() => setPending(null)} className="rounded-xl p-2 hover:bg-accent">
                <X className="size-4" />
              </button>
            </div>
            <label className="mt-3 block text-[10px] font-semibold text-muted-foreground">
              Name
              <input
                value={captureNameValue}
                onChange={(event) => setCaptureNameValue(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="mt-2 block text-[10px] font-semibold text-muted-foreground">
              Notes (optional)
              <textarea
                value={captureNotes}
                onChange={(event) => setCaptureNotes(event.target.value)}
                rows={2}
                placeholder="Condition, access, observation…"
                className="mt-1 w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            {pending.kind === "point" && (
              <div className="mt-3">
                <p className="text-[10px] font-semibold text-muted-foreground">Marker icon</p>
                <div className="mt-1 grid grid-cols-4 gap-1.5">
                  {MARKER_OPTIONS.map((option) => {
                    const active = pending.properties["MARKER_ICON"] === option.symbol;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() =>
                          setPending((current) =>
                            current
                              ? {
                                  ...current,
                                  properties: {
                                    ...current.properties,
                                    MARKER_ICON: option.symbol,
                                  },
                                }
                              : current,
                          )
                        }
                        aria-pressed={active}
                        className={cn(
                          "flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[9px] font-semibold",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-secondary",
                        )}
                      >
                        <span className="text-base leading-none">{option.symbol}</span>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setPending(null)}
                className="flex-1 rounded-2xl bg-secondary py-3 text-xs font-semibold"
              >
                Discard
              </button>
              <button
                onClick={saveCapture}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-xs font-semibold text-primary-foreground"
              >
                <Save className="size-4" /> Save to project
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function FieldAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          onClick();
        } catch (error) {
          const message = error instanceof Error ? error.message : "The field tool could not start";
          console.error(`[field] ${label} failed`, error);
          toast.error(`${label} could not start`, { description: message });
        }
      }}
      className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl bg-secondary px-1 text-[10px] font-semibold active:bg-accent"
    >
      <span className="[&>svg]:size-5">{icon}</span>
      {label}
    </button>
  );
}
