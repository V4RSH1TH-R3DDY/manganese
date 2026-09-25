"""Train LightGBM mineral prospectivity model using spatial block CV."""

import json
from pathlib import Path
import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
import rasterio
from sklearn.metrics import roc_auc_score, average_precision_score
from sklearn.model_selection import GroupKFold

FEATURE_DIR = Path("data/features")
MRDS_PATH = Path("data/fulltext-search.json")
ARTIFACT_OUT = Path("artifacts/prospectivity.joblib")
BACKEND_ARTIFACT = Path("backend/artifacts/prospectivity.joblib")

# MOIL major operating mines
MOIL_MINES = [
    ("Kandri", 21.416, 79.266),
    ("Mansar", 21.383, 79.250),
    ("Dongri Buzurg", 21.548, 79.682),
    ("Balaghat", 21.966, 80.233),
    ("Chikla", 21.516, 79.750)
]

def load_positives(ref_profile):
    positives = []
    # 1. From MRDS search JSON
    with open(MRDS_PATH) as f:
        mrds_list = json.load(f)
    for item in mrds_list:
        try:
            geo = json.loads(item["json"])["geometry"]
            lon, lat = geo["coordinates"]
            if 78.5 <= lon <= 81.0 and 21.0 <= lat <= 22.5:
                positives.append((item.get("site_name", "MRDS deposit"), lat, lon))
        except Exception:
            pass

    # 2. MOIL mines
    for name, lat, lon in MOIL_MINES:
        positives.append((name, lat, lon))

    df_pos = pd.DataFrame(positives, columns=["name", "lat", "lon"]).drop_duplicates(subset=["lat", "lon"])
    print(f"Loaded {len(df_pos)} unique confirmed manganese deposits in belt.")
    return df_pos

def main():
    feat_paths = sorted(FEATURE_DIR.glob("*.tif"))
    if not feat_paths:
        raise SystemExit("No feature rasters found in data/features!")

    feat_names = [p.stem for p in feat_paths]
    print("Features:", feat_names)

    with rasterio.open(feat_paths[0]) as src:
        prof = src.profile
        trans = src.transform
        height, width = src.height, src.width

    # Load all feature grids
    stack = np.stack([rasterio.open(p).read(1) for p in feat_paths], axis=0) # (num_features, H, W)

    # 1. Positives
    df_pos = load_positives(prof)
    pos_coords = list(zip(df_pos.lon, df_pos.lat))

    # Convert coordinates to pixel row, col
    pos_rows, pos_cols = [], []
    for lon, lat in pos_coords:
        r, c = rasterio.transform.rowcol(trans, lon, lat)
        if 0 <= r < height and 0 <= c < width:
            pos_rows.append(r)
            pos_cols.append(c)

    pos_rows = np.array(pos_rows)
    pos_cols = np.array(pos_cols)

    # 2. Pseudo-negatives (Positive-Unlabeled learning)
    # Mask out buffer of ~5km (approx 5 pixels) around positives
    buffer_mask = np.zeros((height, width), dtype=bool)
    for r, c in zip(pos_rows, pos_cols):
        r_min, r_max = max(0, r - 5), min(height, r + 6)
        c_min, c_max = max(0, c - 5), min(width, c + 6)
        buffer_mask[r_min:r_max, c_min:c_max] = True

    neg_r_candidates, neg_c_candidates = np.where(~buffer_mask)
    rng = np.random.default_rng(42)
    # Sample ~4x pseudo-negatives relative to positives
    neg_idx = rng.choice(len(neg_r_candidates), size=len(pos_rows) * 4, replace=False)
    neg_rows = neg_r_candidates[neg_idx]
    neg_cols = neg_c_candidates[neg_idx]

    # Combine into dataset
    all_rows = np.concatenate([pos_rows, neg_rows])
    all_cols = np.concatenate([pos_cols, neg_cols])
    y = np.concatenate([np.ones(len(pos_rows)), np.zeros(len(neg_rows))])

    # Extract features at points
    X_list = []
    for f_idx in range(len(feat_names)):
        X_list.append(stack[f_idx, all_rows, all_cols])
    X = np.stack(X_list, axis=1)

    # Coordinates for spatial blocking
    lons, lats = rasterio.transform.xy(trans, all_rows, all_cols)
    lons = np.array(lons)
    lats = np.array(lats)

    df_train = pd.DataFrame(X, columns=feat_names)
    df_train["lon"] = lons
    df_train["lat"] = lats
    df_train["label"] = y
    df_train["block"] = (df_train["lon"] // 0.2).astype(int).astype(str) + "_" + (df_train["lat"] // 0.2).astype(int).astype(str)

    print(f"Dataset: {len(df_train)} samples ({int(y.sum())} positives, {int((1-y).sum())} pseudo-negatives).")
    print(f"Spatial blocks: {df_train['block'].nunique()} blocks.")

    # Spatial Block CV
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros(len(df_train))

    for tr, va in gkf.split(df_train, df_train.label, df_train.block):
        clf = lgb.LGBMClassifier(
            n_estimators=150,
            learning_rate=0.04,
            num_leaves=15,
            subsample=0.8,
            colsample_bytree=0.8,
            class_weight="balanced",
            random_state=42,
            verbose=-1
        )
        clf.fit(df_train.loc[tr, feat_names], df_train.label.iloc[tr])
        oof[va] = clf.predict_proba(df_train.loc[va, feat_names])[:, 1]

    auc = roc_auc_score(df_train.label, oof)
    ap = average_precision_score(df_train.label, oof)

    # Top 10% capture rate metric
    top10_cutoff = np.percentile(oof, 90)
    top10_capture = (oof[df_train.label == 1] >= top10_cutoff).mean()

    print(f"=== Spatial Block CV Performance ===")
    print(f"OOF ROC-AUC: {auc:.4f}")
    print(f"OOF Avg Precision: {ap:.4f}")
    print(f"Capture of known deposits in top 10% area: {top10_capture*100:.1f}%")

    # Fit full model
    final_model = lgb.LGBMClassifier(
        n_estimators=150,
        learning_rate=0.04,
        num_leaves=15,
        subsample=0.8,
        colsample_bytree=0.8,
        class_weight="balanced",
        random_state=42,
        verbose=-1
    )
    final_model.fit(df_train[feat_names], df_train.label)

    # Feature importances
    importances = sorted(zip(feat_names, final_model.feature_importances_), key=lambda x: x[1], reverse=True)
    print("\nFeature importances:")
    for f, imp in importances:
        print(f"  {f:25s}: {imp}")

    bundle = {
        "model": final_model,
        "features": feat_names,
        "metrics": {"auc": float(auc), "ap": float(ap), "top10_capture": float(top10_capture)}
    }

    ARTIFACT_OUT.parent.mkdir(parents=True, exist_ok=True)
    BACKEND_ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, ARTIFACT_OUT)
    joblib.dump(bundle, BACKEND_ARTIFACT)
    print(f"\nSaved model artifact to {ARTIFACT_OUT} and {BACKEND_ARTIFACT}")

if __name__ == "__main__":
    main()
