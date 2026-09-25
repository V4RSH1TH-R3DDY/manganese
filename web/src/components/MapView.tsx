import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DrillHolePoint, MineSummary } from "../lib/api";
import { fmtT } from "../lib/format";

export type BasemapMode = "black" | "satellite" | "streets";

interface Props {
  mines: MineSummary[]; selected: string; onSelect: (code: string) => void;
  prospectivity?: { tiles: string; bounds: [number, number, number, number] };
  showProsp: boolean;
  basemap?: BasemapMode;
  drillholes?: DrillHolePoint[];
  showDrillholes?: boolean;
}
const COLOR = ["match", ["get", "level"], "red", "#ef4444", "amber", "#f59e0b", "#22c55e"] as any;

// Global satellite basemap (Esri World Imagery) + standard OpenStreetMap
const SATELLITE_TILES = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];
const SATELLITE_ATTRIB = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

const OSM_TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
const OSM_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// CartoDB Dark Matter / Positron or Dark canvas for blackmap
const CARTO_DARK_TILES = ["https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png"];
const CARTO_DARK_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function MapView({
  mines, selected, onSelect, prospectivity, showProsp, basemap = "black",
  drillholes, showDrillholes = false,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const minesRef = useRef(mines); minesRef.current = mines;
  const popup = useRef<{ code: string; p: maplibregl.Popup } | null>(null);

  useEffect(() => {                                            // create map once
    const m = new maplibregl.Map({
      container: el.current!, center: [79.8, 21.5], zoom: 7.4,
      style: {
        version: 8,
        sources: {
          dark: { type: "raster", tileSize: 256, maxzoom: 19, attribution: CARTO_DARK_ATTRIB, tiles: CARTO_DARK_TILES },
          satellite: { type: "raster", tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIB, tiles: SATELLITE_TILES },
          osm: { type: "raster", tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIB, tiles: OSM_TILES },
        },
        layers: [
          { id: "dark-layer", type: "raster", source: "dark", layout: { visibility: "visible" } },
          { id: "satellite-layer", type: "raster", source: "satellite", layout: { visibility: "none" } },
          { id: "osm-layer", type: "raster", source: "osm", layout: { visibility: "none" } },
          // Subtle tint so markers and prospectivity layer stand out
          { id: "dim", type: "background",
            paint: { "background-color": "#050505", "background-opacity": 0.2 } },
        ],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {                                            // basemap toggle
    const m = map.current; if (!m) return;
    const apply = () => {
      if (m.getLayer("dark-layer")) {
        m.setLayoutProperty("dark-layer", "visibility", basemap === "black" ? "visible" : "none");
      }
      if (m.getLayer("satellite-layer")) {
        m.setLayoutProperty("satellite-layer", "visibility", basemap === "satellite" ? "visible" : "none");
      }
      if (m.getLayer("osm-layer")) {
        m.setLayoutProperty("osm-layer", "visibility", basemap === "streets" ? "visible" : "none");
      }
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [basemap]);

  useEffect(() => {                                            // prospectivity raster
    const m = map.current; if (!m || !prospectivity) return;
    const apply = () => {
      if (!m.getSource("prosp")) {
        m.addSource("prosp", { type: "raster", tiles: [prospectivity.tiles], tileSize: 256, bounds: prospectivity.bounds });
        m.addLayer({ id: "prosp", type: "raster", source: "prosp", paint: { "raster-opacity": 0.75 } },
          m.getLayer("mines-halo") ? "mines-halo" : undefined);
      }
      m.setLayoutProperty("prosp", "visibility", showProsp ? "visible" : "none");
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [prospectivity, showProsp]);

  useEffect(() => {                                            // drillhole markers
    const m = map.current; if (!m || !drillholes) return;
    const dhFc: any = {
      type: "FeatureCollection",
      features: drillholes.map((d) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
        properties: { id: d.id, mine: d.mine_code, z: d.collar_z },
      })),
    };
    const apply = () => {
      const src = m.getSource("drillholes") as GeoJSONSource | undefined;
      if (src) {
        src.setData(dhFc);
      } else {
        m.addSource("drillholes", { type: "geojson", data: dhFc });
        m.addLayer({
          id: "drillholes-dot",
          type: "circle",
          source: "drillholes",
          paint: {
            "circle-radius": 3.5,
            "circle-color": "#c084fc",
            "circle-stroke-color": "#18181b",
            "circle-stroke-width": 1,
            "circle-opacity": 0.9,
          },
        });
        m.on("click", "drillholes-dot", (e) => {
          const p = e.features![0].properties as any;
          new maplibregl.Popup({ closeButton: false })
            .setLngLat((e.features![0].geometry as any).coordinates)
            .setHTML(`<b>Drill Hole #${p.id}</b><br/>Mine: ${p.mine}<br/>Collar Z: ${p.z}m`)
            .addTo(m);
        });
      }
      if (m.getLayer("drillholes-dot")) {
        m.setLayoutProperty("drillholes-dot", "visibility", showDrillholes ? "visible" : "none");
      }
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [drillholes, showDrillholes]);

  useEffect(() => {                                            // mine markers
    const m = map.current; if (!m) return;
    const fc: any = { type: "FeatureCollection", features: mines.map((x) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] },
      properties: { code: x.code, name: x.name, level: x.level, pct: x.expected_shortfall_pct, res: x.reserve_p50_t } })) };
    const apply = () => {
      const src = m.getSource("mines") as GeoJSONSource | undefined;
      if (src) { src.setData(fc); return; }
      m.addSource("mines", { type: "geojson", data: fc });
      m.addLayer({ id: "mines-halo", type: "circle", source: "mines", paint: { "circle-radius": 20, "circle-color": COLOR, "circle-opacity": 0.28 } });
      m.addLayer({ id: "mines-dot", type: "circle", source: "mines",
        paint: { "circle-radius": 6.5, "circle-color": COLOR, "circle-stroke-color": "#0a0a0a", "circle-stroke-width": 1.5 } });
      m.on("click", "mines-dot", (e) => {
        const p = e.features![0].properties as any;
        popup.current?.p.remove();
        popup.current = { code: p.code, p: new maplibregl.Popup({ closeButton: false }).setLngLat((e.features![0].geometry as any).coordinates)
          .setHTML(`<b>${p.name}</b><br/>Shortfall ${Number(p.pct).toFixed(1)}%${p.res ? `<br/>Reserve P50 ${fmtT(Number(p.res))}` : ""}`).addTo(m) };
        onSelect(p.code);
      });
      m.on("mouseenter", "mines-dot", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "mines-dot", () => (m.getCanvas().style.cursor = ""));
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [mines, onSelect]);

  useEffect(() => {                                            // fly to + highlight selection
    const m = map.current, s = minesRef.current.find((x) => x.code === selected);
    if (!m || !s) return;
    if (popup.current && popup.current.code !== selected) { popup.current.p.remove(); popup.current = null; }
    m.flyTo({ center: [s.lon, s.lat], zoom: 9.5, duration: 900 });
    if (m.getLayer("mines-dot"))
      m.setPaintProperty("mines-dot", "circle-stroke-width", ["case", ["==", ["get", "code"], selected], 3, 1.5]);
  }, [selected]);

  return <div ref={el} className="h-[560px] lg:h-[600px] w-full border border-neutral-800" />;
}
