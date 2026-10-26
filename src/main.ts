import * as maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

type Period = "hour" | "day" | "week";
type Quake = GeoJSON.Feature<GeoJSON.Point, { mag: number | null; place: string; time: number; url: string }>;

const FEED = (p: Period) => `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_${p}.geojson`;
const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};
const REFRESH_MS = 60_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  period: "day" as Period,
  minMag: 2.5,
  quakes: [] as Quake[],
  theme: ((): "dark" | "light" => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  })(),
};

document.documentElement.dataset.theme = state.theme;

const colorExpr: maplibregl.ExpressionSpecification = [
  "step", ["coalesce", ["get", "mag"], 0],
  "#ffd166", 3, "#ff9f1c", 4, "#ff5a36", 5, "#d00050", 6, "#7b00d4",
];
const magColor = (m: number) => (m < 3 ? "#ffd166" : m < 4 ? "#ff9f1c" : m < 5 ? "#ff5a36" : m < 6 ? "#d00050" : "#7b00d4");

const map = new maplibregl.Map({
  container: "map",
  style: STYLES[state.theme],
  center: [10, 25],
  zoom: 1.6,
  attributionControl: { compact: true },
  maxPitch: 0,
  locale: {
    "NavigationControl.ZoomIn": "Acercar",
    "NavigationControl.ZoomOut": "Alejar",
    "AttributionControl.ToggleAttribution": "Mostrar atribución",
    "AttributionControl.MapFeedback": "Comentarios del mapa",
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

const popup = new maplibregl.Popup({ closeButton: false, offset: 12, maxWidth: "260px" });

function fc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: visible() };
}

function visible(): Quake[] {
  return state.quakes.filter((q) => (q.properties.mag ?? 0) >= state.minMag);
}

// El USGS devuelve el lugar en inglés ("81 km SSE of Akutan, Alaska").
function lugar(q: Quake): string {
  const place = q.properties.place;
  if (!place) return "Ubicación desconocida";
  const m = place.match(/^(\d+) km ([NSEW]{1,3}) of (.+)$/);
  return m ? `A ${m[1]} km al ${m[2].replace(/W/g, "O")} de ${m[3]}` : place;
}

// Etiquetas del mapa base en español cuando existan.
function etiquetasEnEspanol() {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      map.setLayoutProperty(layer.id, "text-field", [
        "coalesce", ["get", "name:es"], ["get", "name:latin"], ["get", "name"],
      ]);
    }
  }
}

function addLayers() {
  etiquetasEnEspanol();
  if (map.getSource("quakes")) return;
  map.addSource("quakes", { type: "geojson", data: fc() });

  map.addLayer({
    id: "pulse",
    type: "circle",
    source: "quakes",
    filter: [">", ["get", "time"], Date.now() - 30 * 60_000],
    paint: {
      "circle-radius": 10,
      "circle-color": colorExpr,
      "circle-opacity": 0.3,
      "circle-stroke-width": 0,
    },
  });
  map.addLayer({
    id: "dots",
    type: "circle",
    source: "quakes",
    paint: {
      "circle-radius": ["interpolate", ["exponential", 1.6], ["coalesce", ["get", "mag"], 0], 0, 2.5, 3, 6, 5, 16, 7, 38],
      "circle-color": colorExpr,
      "circle-opacity": 0.78,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.7,
      "circle-stroke-opacity": 0.6,
    },
  });

  map.on("click", "dots", (e) => {
    const f = e.features?.[0];
    if (f) showPopup(f as unknown as Quake);
  });
  map.on("mouseenter", "dots", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "dots", () => (map.getCanvas().style.cursor = ""));
}

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "hace segundos";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function showPopup(q: Quake) {
  const [lng, lat, depth] = q.geometry.coordinates;
  const url = /^https:\/\/earthquake\.usgs\.gov\//.test(q.properties.url) ? q.properties.url : "https://earthquake.usgs.gov/";
  popup
    .setLngLat([lng, lat])
    .setHTML(
      `<div class="pop"><div class="pop-mag" style="color:${magColor(q.properties.mag ?? 0)}">M ${(q.properties.mag ?? 0).toFixed(1)}</div>
       <div><b>${esc(lugar(q))}</b></div>
       <div class="when">${ago(q.properties.time)} · profundidad ${depth.toFixed(0)} km</div>
       <a href="${url}" target="_blank" rel="noopener">Ver en USGS ↗</a></div>`,
    )
    .addTo(map);
}

function renderList() {
  const list = $("list");
  const items = visible().sort((a, b) => b.properties.time - a.properties.time);
  $("count").textContent = `${items.length} terremotos`;
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Sin terremotos con este filtro.";
    list.append(li);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const q of items.slice(0, 150)) {
    const m = q.properties.mag ?? 0;
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.innerHTML = `<div class="mag" style="background:${magColor(m)}">${m.toFixed(1)}</div>
      <div><div class="place">${esc(lugar(q))}</div><div class="when">${ago(q.properties.time)}</div></div>`;
    const go = () => {
      const [lng, lat] = q.geometry.coordinates;
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 5), speed: 1.4 });
      showPopup(q);
    };
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => e.key === "Enter" && go());
    frag.append(li);
  }
  list.append(frag);
}

let encuadrado = false;
// Primera carga: encuadra el mapa en los terremotos visibles, dejando sitio al panel en escritorio.
function encuadrar() {
  const pts = visible().map((q) => q.geometry.coordinates);
  if (encuadrado || !pts.length) return;
  encuadrado = true;
  const b = new maplibregl.LngLatBounds();
  pts.forEach(([lng, lat]) => b.extend([lng, lat]));
  const desktop = innerWidth > 720;
  map.fitBounds(b, { padding: { top: 40, right: 40, bottom: 40, left: desktop ? 400 : 40 }, maxZoom: 4, duration: 0 });
}

function refreshMap() {
  const src = map.getSource("quakes") as maplibregl.GeoJSONSource | undefined;
  src?.setData(fc());
  if (map.getLayer("pulse")) map.setFilter("pulse", [">", ["get", "time"], Date.now() - 30 * 60_000]);
}

async function load() {
  try {
    const res = await fetch(FEED(state.period), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point>;
    state.quakes = data.features as Quake[];
    $("live").classList.remove("off");
    $("updated").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    refreshMap();
    renderList();
    encuadrar();
  } catch {
    $("live").classList.add("off");
    $("updated").textContent = "sin conexión";
  }
}

// Pulso animado para los terremotos de los últimos 30 minutos.
function animatePulse(t: number) {
  if (map.getLayer("pulse")) {
    const k = (t % 1800) / 1800;
    map.setPaintProperty("pulse", "circle-radius", 8 + k * 26);
    map.setPaintProperty("pulse", "circle-opacity", 0.45 * (1 - k));
  }
  requestAnimationFrame(animatePulse);
}
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(animatePulse);

map.on("style.load", addLayers);
load();
setInterval(load, REFRESH_MS);
setInterval(renderList, 30_000);

document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelector(".seg .active")?.classList.remove("active");
    b.classList.add("active");
    state.period = b.dataset.period as Period;
    popup.remove();
    load();
  }),
);

$<HTMLInputElement>("mag").addEventListener("input", (e) => {
  state.minMag = Number((e.target as HTMLInputElement).value);
  $("magval").textContent = state.minMag.toFixed(1);
  refreshMap();
  renderList();
});

$("theme").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem("theme", state.theme); } catch {}
  map.setStyle(STYLES[state.theme]);
});

// Panel plegable en móvil.
$("fold").addEventListener("click", () => {
  const panel = $("panel");
  const collapsed = panel.classList.toggle("collapsed");
  $("fold").textContent = collapsed ? "▴" : "▾";
  $("fold").setAttribute("aria-expanded", String(!collapsed));
});
