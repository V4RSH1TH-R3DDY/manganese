import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MineSummary } from "../lib/api";
import { fmtT } from "../lib/format";

interface Props {
  mines: MineSummary[]; selected: string; onSelect: (code: string) => void;
  prospectivity?: { tiles: string; bounds: [number, number, number, number] }; showProsp: boolean;
}
const COLOR = ["match", ["get", "level"], "red", "#ef4444", "amber", "#f59e0b", "#22c55e"] as any;

export default function MapView({ mines, selected, onSelect, prospectivity, showProsp }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const minesRef = useRef(mines); minesRef.current = mines;
  const popup = useRef<{ code: string; p: maplibregl.Popup } | null>(null);

  useEffect(() => {                                            // create map once
    const m = new maplibregl.Map({
      container: el.current!, center: [79.8, 21.5], zoom: 7.4,
      style: { version: 8,
        sources: { sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
        layers: [{ id: "sat", type: "raster", source: "sat" }] },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {                                            // prospectivity raster
    const m = map.current; if (!m || !prospectivity) return;
    const apply = () => {
      if (!m.getSource("prosp")) {
        m.addSource("prosp", { type: "raster", tiles: [prospectivity.tiles], tileSize: 256, bounds: prospectivity.bounds });
        m.addLayer({ id: "prosp", type: "raster", source: "prosp", paint: { "raster-opacity": 0.65 } },
          m.getLayer("mines-halo") ? "mines-halo" : undefined);
      }
      m.setLayoutProperty("prosp", "visibility", showProsp ? "visible" : "none");
    };
    m.isStyleLoaded() ? apply() : m.once("load", apply);
  }, [prospectivity, showProsp]);

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
        paint: { "circle-radius": 8, "circle-color": COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
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
      m.setPaintProperty("mines-dot", "circle-stroke-width", ["case", ["==", ["get", "code"], selected], 4, 1.5]);
  }, [selected]);

  return <div ref={el} className="h-[420px] w-full overflow-hidden rounded-2xl border border-slate-800" />;
}
