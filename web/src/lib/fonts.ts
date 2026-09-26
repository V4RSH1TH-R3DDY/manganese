import { useEffect, useState } from "react";

// ECharts draws text on canvas, which does not re-render when web fonts arrive.
export const CHART_MONO = '"JetBrains Mono", ui-monospace, monospace';
export const CHART_SANS = '"Inter Tight", ui-sans-serif, system-ui, sans-serif';

/** True once web fonts have loaded; charts put this in their option so they redraw with the real fonts. */
export function useFontsReady() {
  const [ready, setReady] = useState(document.fonts.status === "loaded");
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => live && setReady(true));
    return () => { live = false; };
  }, []);
  return ready;
}
