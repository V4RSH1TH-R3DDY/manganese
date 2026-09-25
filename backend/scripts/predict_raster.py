"""Prospectivity model -> probability GeoTIFF -> COG for TiTiler and MapView."""

from pathlib import Path
import joblib
import numpy as np
import rasterio
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles


def _resolve_paths():
    candidates = [
        Path(__file__).resolve().parents[2],          # local repo root
        Path("/app"),                                 # docker container app dir
        Path("."),                                    # current working directory
    ]
    for root in candidates:
        if (root / "artifacts/prospectivity.joblib").exists():
            return {
                "artifact": root / "artifacts/prospectivity.joblib",
                "features": Path("/data/features") if Path("/data/features").exists() else root / "data/features",
                "raw_out": Path("/data/interim/prosp_raw.tif") if Path("/data").exists() else root / "data/interim/prosp_raw.tif",
                "cog_out": Path("/data/cogs/prospectivity.tif") if Path("/data").exists() else root / "data/cogs/prospectivity.tif",
            }
    # fallback default
    root = candidates[0]
    return {
        "artifact": root / "artifacts/prospectivity.joblib",
        "features": root / "data/features",
        "raw_out": root / "data/interim/prosp_raw.tif",
        "cog_out": root / "data/cogs/prospectivity.tif",
    }


def main():
    paths_dict = _resolve_paths()
    artifact_path = paths_dict["artifact"]
    feature_dir = paths_dict["features"]
    raw_out = paths_dict["raw_out"]
    cog_out = paths_dict["cog_out"]

    if not artifact_path.exists():
        raise SystemExit(f"Model artifact not found at {artifact_path}. Run pipelines/train_prospectivity.py first.")

    bundle = joblib.load(artifact_path)
    model = bundle["model"] if isinstance(bundle, dict) else bundle
    expected_features = bundle.get("features", None) if isinstance(bundle, dict) else None

    paths = sorted(feature_dir.glob("*.tif"))
    if not paths:
        raise SystemExit(f"no feature rasters in {feature_dir}")

    print(f"Loading {len(paths)} feature rasters from {feature_dir}...")
    arrs = [rasterio.open(p).read(1).astype("float32") for p in paths]
    prof = rasterio.open(paths[0]).profile.copy()

    # Flatten and stack features
    X = np.stack([a.ravel() for a in arrs], axis=1)

    print(f"Running raster inference on {X.shape[0]} grid cells...")
    prob = model.predict_proba(X)[:, 1].reshape(arrs[0].shape).astype("float32")

    # Mask out invalid cells
    invalid_mask = np.isnan(arrs[0]) | (arrs[0] == -9999.0)
    prob[invalid_mask] = -1.0

    prof.update(count=1, dtype="float32", nodata=-1.0, driver="GTiff")

    raw_out.parent.mkdir(parents=True, exist_ok=True)
    cog_out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Writing raw raster to {raw_out}...")
    with rasterio.open(raw_out, "w", **prof) as dst:
        dst.write(prob, 1)

    print(f"Converting to Cloud-Optimized GeoTIFF (COG) at {cog_out}...")
    cog_translate(raw_out, cog_out, cog_profiles.get("deflate"), in_memory=True, quiet=False)
    print("Successfully generated COG:", cog_out)
    valid_prob = prob[prob >= 0]
    if len(valid_prob) > 0:
        print(f"Probability statistics: min={valid_prob.min():.4f}, mean={valid_prob.mean():.4f}, max={valid_prob.max():.4f}")


if __name__ == "__main__":
    main()
