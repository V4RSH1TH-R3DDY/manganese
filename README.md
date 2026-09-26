<div align="center">

# MOIL Manganese Copilot

### Turn mine signals into better next-shift decisions.

**SIH 2026 · Problem Statement 26009**

</div>

<p align="center">
  <img src="docs/media/recommended-actions.png" alt="MOIL Copilot command view ranking mining actions by expected recovery and confidence" width="100%">
</p>

Mine teams make linked decisions every day: where to explore, what reserves may be present, and how to keep production on plan. MOIL Manganese Copilot brings those signals into one decision-support workflow, helping teams see emerging risk, understand its drivers, and compare practical next steps.

## Our approach

1. **Explore:** satellite and geology indicators rank areas for investigation. Drill-hole assays inform approximate reserve ranges.
2. **Anticipate:** production, weather, equipment, and blasting data reveal shortfall risk and the factors driving it.
3. **Respond:** operational recommendations are ranked by estimated recovery and confidence, then tested with a what-if forecast.

Satellite data does **not** detect manganese underground. It helps prioritize places to investigate; geological sampling is needed to estimate grade and tonnes. Demo operations and drill data are labeled as synthetic. Weather can use the live Open-Meteo feed, while production, equipment, blasting, and assay data become mine-specific when real records are supplied.

## Walkthrough

<video controls preload="metadata" width="100%" poster="https://raw.githubusercontent.com/MUKUL-PRASAD-SIGH/manganese/main/docs/media/recommended-actions.png">
  <source src="https://raw.githubusercontent.com/MUKUL-PRASAD-SIGH/manganese/main/docs/media/moil-short-demo.webm" type="video/webm">
  Your browser cannot play this WebM video. <a href="https://raw.githubusercontent.com/MUKUL-PRASAD-SIGH/manganese/main/docs/media/moil-short-demo.webm">Download the walkthrough</a>.
</video>

If the player is unavailable in your GitHub view, [open or download the short WebM walkthrough](https://raw.githubusercontent.com/MUKUL-PRASAD-SIGH/manganese/main/docs/media/moil-short-demo.webm).

## Run it

Requires GNU Make, Node 20+, and Python 3.12 (or [uv](https://docs.astral.sh/uv/), which fetches it). No Docker or `.env` needed. From the repository folder:

```bash
make          # install, seed demo data, train, precompute, then start API + dashboard
```

Open <http://localhost:5173>. The API explorer is at <http://localhost:8000/docs>. `make help` lists every step; re-run `make data` on the day you demo, since the scripted storm is placed 3–5 days after seeding.

**Five MOIL mines. One clearer path from uncertainty to action.**
