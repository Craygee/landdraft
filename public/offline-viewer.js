const canvas = document.querySelector("#map"),
  ctx = canvas.getContext("2d");
const areas = document.querySelector("#areas"),
  guidance = document.querySelector("#guidance");
const project = ([lng, lat]) => [
  lng / 360 + 0.5,
  (1 -
    Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) /
      Math.PI) /
    2,
];
const unproject = ([x, y]) => [
  (x - 0.5) * 360,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
];
let pack,
  packs = [],
  lines = [],
  polygons = [],
  labels = [],
  scale = 1,
  fitScale = 1,
  center = [0.5, 0.5],
  width = 1,
  height = 1,
  frame = 0,
  gps = null,
  gpsWatch = null,
  target = null,
  targetMode = false;
const screen = ([x, y]) => [
  (x - center[0]) * scale + width / 2,
  (y - center[1]) * scale + height / 2,
];
const world = ([x, y]) => [
  (x - width / 2) / scale + center[0],
  (y - height / 2) / scale + center[1],
];
const requestDraw = () => {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
};
function trace(rings) {
  ctx.beginPath();
  for (const ring of rings)
    ring.forEach((p, i) => {
      const [x, y] = screen(p);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
}
function visible(item) {
  const a = screen([item.bounds[0], item.bounds[1]]),
    b = screen([item.bounds[2], item.bounds[3]]);
  return b[0] >= 0 && a[0] <= width && b[1] >= 0 && a[1] <= height;
}
function draw() {
  ctx.clearRect(0, 0, width, height);
  if (!pack) return;
  const a = screen(project([pack.bounds[0], pack.bounds[3]])),
    b = screen(project([pack.bounds[2], pack.bounds[1]]));
  ctx.fillStyle = "#f9f8ed";
  ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  ctx.clip();
  ctx.strokeStyle = "#4e8261";
  ctx.fillStyle = "#2f7d4f0a";
  ctx.lineWidth = 1;
  for (const item of polygons) {
    if (!visible(item)) continue;
    const min = screen(item.bounds.slice(0, 2)),
      max = screen(item.bounds.slice(2));
    if ((max[0] - min[0]) * (max[1] - min[1]) < 20) continue;
    trace(item.rings);
    ctx.fill("evenodd");
    ctx.stroke();
  }
  ctx.strokeStyle = "#c38639";
  ctx.lineWidth = 2;
  for (const line of lines) {
    if (!visible(line)) continue;
    trace(line.rings);
    ctx.stroke();
  }
  const occupied = [];
  let count = 0;
  const zoom = Math.log2(scale / 512);
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of labels) {
    if (zoom < label.minZoom || count >= 180) continue;
    const p = screen(label.point),
      parts = label.text.split("\n"),
      w = Math.max(...parts.map((text) => ctx.measureText(text).width)),
      h = parts.length * 14;
    const box = [p[0] - w / 2 - 3, p[1] - h / 2 - 2, p[0] + w / 2 + 3, p[1] + h / 2 + 2];
    if (
      box[0] < Math.max(0, a[0]) ||
      box[2] > Math.min(width, b[0]) ||
      box[1] < Math.max(0, a[1]) ||
      box[3] > Math.min(height, b[1]) ||
      occupied.some(
        (other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1],
      )
    )
      continue;
    occupied.push(box);
    count++;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fffef5";
    ctx.fillStyle = "#173c25";
    parts.forEach((text, i) => {
      const y = p[1] + (i - (parts.length - 1) / 2) * 14;
      ctx.strokeText(text, p[0], y);
      ctx.fillText(text, p[0], y);
    });
  }
  ctx.restore();
  ctx.strokeStyle = "#537b68";
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  ctx.setLineDash([]);
  if (gps && target) {
    ctx.strokeStyle = "#3562ad";
    ctx.setLineDash([6, 5]);
    trace([[project([gps.longitude, gps.latitude]), project(target)]]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const [point, color] of [
    [gps ? [gps.longitude, gps.latitude] : null, "#2274cf"],
    [target, "#ca4b26"],
  ]) {
    if (!point) continue;
    const p = screen(project(point));
    ctx.beginPath();
    ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
function prepared(geometry, properties) {
  const rings =
    geometry.type === "Polygon" || geometry.type === "MultiLineString"
      ? geometry.coordinates
      : geometry.type === "LineString"
        ? [geometry.coordinates]
        : [];
  const transformed = rings.map((ring) => ring.map(project));
  let west = Infinity,
    north = Infinity,
    east = -Infinity,
    south = -Infinity;
  for (const ring of transformed)
    for (const p of ring) {
      west = Math.min(west, p[0]);
      east = Math.max(east, p[0]);
      north = Math.min(north, p[1]);
      south = Math.max(south, p[1]);
    }
  return { rings: transformed, bounds: [west, north, east, south], properties };
}
let offlineDb,
  loadVersion = 0;
async function loadPack(id) {
  const entry = packs.find((item) => item.id === id);
  if (!entry || !offlineDb) return;
  areas.value = id;
  const ticket = ++loadVersion;
  try {
    const data = await new Promise((resolve, reject) => {
      const request = offlineDb.transaction("areas").objectStore("areas").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (ticket !== loadVersion) return;
    if (!data || data.userId !== entry.userId)
      throw new Error("This downloaded area is unavailable");
    renderPack(data);
  } catch (error) {
    guidance.textContent = `Area could not be opened: ${error.message}`;
  }
}
function renderPack(data) {
  pack = data;
  polygons = [];
  lines = [];
  target = null;
  for (const feature of pack.parcels.features) {
    if (feature.geometry?.type === "MultiPolygon")
      for (const coords of feature.geometry.coordinates)
        polygons.push(prepared({ type: "Polygon", coordinates: coords }, feature.properties));
    else if (feature.geometry?.type === "Polygon")
      polygons.push(prepared(feature.geometry, feature.properties));
  }
  for (const feature of pack.roads.features)
    if (feature.geometry) lines.push(prepared(feature.geometry, feature.properties));
  labels = pack.labels.features.map((feature) => ({
    point: project(feature.geometry.coordinates),
    text: String(feature.properties.__label || ""),
    minZoom: feature.properties.__parcelLabelMinZoom || 0,
  }));
  document.querySelector("#details").textContent =
    `${pack.name} · Saved ${new Date(pack.savedAt).toLocaleString()} · ${(pack.bytes / 1048576).toFixed(1)} MB · ${pack.coverage}`;
  document.querySelector("#source").textContent = pack.attribution;
  guidance.textContent =
    "Offline ready. Tap a parcel for its owner, or set a target for GPS guidance.";
  fit();
}
function fit() {
  if (!pack) return;
  const a = project([pack.bounds[0], pack.bounds[3]]),
    b = project([pack.bounds[2], pack.bounds[1]]);
  center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  fitScale = Math.min(
    Math.max(80, width - 110) / (b[0] - a[0]),
    Math.max(80, height - 70) / (b[1] - a[1]),
  );
  scale = fitScale;
  requestDraw();
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestDraw();
}
function zoom(factor, at = [width / 2, height / 2]) {
  const old = world(at);
  scale = Math.max(fitScale * 0.5, Math.min(512 * 2 ** 21, scale * factor));
  const next = world(at);
  center = [center[0] + old[0] - next[0], center[1] + old[1] - next[1]];
  requestDraw();
}
function pointIn(point, rings) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a[1] > point[1] !== b[1] > point[1] &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
  return inside;
}
function tap(at) {
  if (!pack) return;
  const p = world(at),
    location = unproject(p);
  if (targetMode) {
    if (
      location[0] < pack.bounds[0] ||
      location[0] > pack.bounds[2] ||
      location[1] < pack.bounds[1] ||
      location[1] > pack.bounds[3]
    ) {
      guidance.textContent = "Choose a target within the downloaded area.";
      return;
    }
    target = location;
    targetMode = false;
    document.querySelector("#target").setAttribute("aria-pressed", "false");
    updateGuidance();
    requestDraw();
    return;
  }
  const hit = polygons.find(
    (item) =>
      p[0] >= item.bounds[0] &&
      p[0] <= item.bounds[2] &&
      p[1] >= item.bounds[1] &&
      p[1] <= item.bounds[3] &&
      pointIn(p, item.rings),
  );
  guidance.textContent = hit
    ? `${hit.properties.OWNER_NAME || "Owner unavailable"} · Parcel ${hit.properties.PROP_ID || "ID unavailable"} · ${hit.properties.COUNTY || ""}`
    : "No parcel downloaded at this location.";
}
function updateGuidance() {
  if (!gps) {
    guidance.textContent = target
      ? "Target saved. Turn GPS on for straight-line guidance."
      : "Waiting for GPS…";
    return;
  }
  const outside =
    pack &&
    (gps.longitude < pack.bounds[0] ||
      gps.longitude > pack.bounds[2] ||
      gps.latitude < pack.bounds[1] ||
      gps.latitude > pack.bounds[3]);
  if (!target) {
    guidance.textContent = `GPS ±${Math.round(gps.accuracy)} m${outside ? " · Outside downloaded area" : ""}. Set a target for distance and bearing.`;
    return;
  }
  const rad = Math.PI / 180,
    a = gps.latitude * rad,
    b = target[1] * rad,
    d = (target[0] - gps.longitude) * rad;
  const h = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(d / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const bearing =
    (Math.atan2(
      Math.sin(d) * Math.cos(b),
      Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d),
    ) /
      rad +
      360) %
    360;
  guidance.textContent = `${(distance / 1609.344).toFixed(2)} mi · Bearing ${bearing.toFixed(0)}° true · GPS ±${Math.round(gps.accuracy)} m${outside ? " · Outside saved area" : ""} · Straight-line guidance only`;
}
const pointers = new Map();
let start = null,
  moved = false;
canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect(),
    p = [event.clientX - rect.left, event.clientY - rect.top];
  pointers.set(event.pointerId, p);
  canvas.setPointerCapture(event.pointerId);
  start = p;
  moved = pointers.size > 1;
});
canvas.addEventListener("pointermove", (event) => {
  const old = pointers.get(event.pointerId);
  if (!old) return;
  const rect = canvas.getBoundingClientRect(),
    p = [event.clientX - rect.left, event.clientY - rect.top];
  const before = [...pointers.values()];
  pointers.set(event.pointerId, p);
  if (start && Math.hypot(p[0] - start[0], p[1] - start[1]) > 5) moved = true;
  if (pointers.size === 1) {
    center = [center[0] - (p[0] - old[0]) / scale, center[1] - (p[1] - old[1]) / scale];
  } else if (pointers.size === 2) {
    moved = true;
    const after = [...pointers.values()],
      previous = Math.hypot(before[0][0] - before[1][0], before[0][1] - before[1][1]),
      next = Math.hypot(after[0][0] - after[1][0], after[0][1] - after[1][1]);
    if (previous > 1)
      zoom(next / previous, [
        (p[0] + after.find((item) => item !== p)[0]) / 2,
        (p[1] + after.find((item) => item !== p)[1]) / 2,
      ]);
  }
  requestDraw();
});
canvas.addEventListener("pointerup", (event) => {
  const p = pointers.get(event.pointerId);
  if (p && !moved && pointers.size === 1) tap(p);
  pointers.delete(event.pointerId);
});
canvas.addEventListener("pointercancel", (event) => pointers.delete(event.pointerId));
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, [event.clientX - r.left, event.clientY - r.top]);
  },
  { passive: false },
);
canvas.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") zoom(1.5);
  else if (event.key === "-") zoom(1 / 1.5);
  else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    center = [
      center[0] + (event.key === "ArrowLeft" ? -40 : event.key === "ArrowRight" ? 40 : 0) / scale,
      center[1] + (event.key === "ArrowUp" ? -40 : event.key === "ArrowDown" ? 40 : 0) / scale,
    ];
    requestDraw();
  }
});
document.querySelector("#fit").onclick = fit;
document.querySelector("#plus").onclick = () => zoom(1.5);
document.querySelector("#minus").onclick = () => zoom(1 / 1.5);
document.querySelector("#target").onclick = () => {
  targetMode = !targetMode;
  document.querySelector("#target").setAttribute("aria-pressed", String(targetMode));
  guidance.textContent = targetMode
    ? "Tap your target inside the downloaded area."
    : "Target selection canceled.";
};
function stopGps() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  gps = null;
  document.querySelector("#gps").textContent = "GPS off";
  guidance.textContent = target
    ? "GPS off. Target saved; no live position is being tracked."
    : "GPS off. Your live position is no longer tracked.";
  requestDraw();
}
document.querySelector("#gps").onclick = () => {
  if (gpsWatch !== null) {
    stopGps();
    return;
  }
  if (!navigator.geolocation) {
    guidance.textContent = "GPS is unavailable in this browser.";
    return;
  }
  document.querySelector("#gps").textContent = "GPS on";
  gpsWatch = navigator.geolocation.watchPosition(
    (position) => {
      gps = position.coords;
      updateGuidance();
      requestDraw();
    },
    (error) => {
      stopGps();
      guidance.textContent = `GPS unavailable: ${error.message}`;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
};
window.addEventListener("pagehide", stopGps);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopGps();
});
areas.onchange = () => loadPack(areas.value);
new ResizeObserver(resize).observe(canvas);
resize();
try {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("landdraft-offline-areas-v1", 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("areas"))
        r.result.createObjectStore("areas", { keyPath: "id" });
      if (!r.result.objectStoreNames.contains("metadata")) {
        const metadata = r.result.createObjectStore("metadata", { keyPath: "id" });
        const request = r.transaction.objectStore("areas").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const { parcels, roads, labels, ...entry } = cursor.value;
          metadata.put(entry);
          cursor.continue();
        };
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const all = await new Promise((resolve, reject) => {
    const r = db.transaction("metadata").objectStore("metadata").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  offlineDb = db;
  db.onversionchange = () => db.close();
  const user =
    new URLSearchParams(location.search).get("user") ||
    localStorage.getItem("landdraft.offline-user");
  packs = all.filter((item) => item.userId === user);
  areas.replaceChildren();
  for (const item of packs) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    areas.append(option);
  }
  if (packs.length) loadPack(new URLSearchParams(location.search).get("area") || packs[0].id);
  else {
    guidance.textContent =
      "No downloaded areas for this account. While online, open LandDraft → Data → Offline areas and save an extent first.";
  }
} catch (error) {
  guidance.textContent = `Downloads could not be read: ${error.message}`;
}
