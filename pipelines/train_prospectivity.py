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
DEPOSITS_JSON = Path("data/deposits.json")
MRDS_PATH = Path("data/fulltext-search.json")
ARTIFACT_OUT = Path("artifacts/prospectivity.joblib")
BACKEND_ARTIFACT = Path("backend/artifacts/prospectivity.joblib")

# MOIL major operating mines
MOIL_MINES = [
    ("Kandri", 21.416, 79.266),
    ("Mansar", 21.383, 79.250),
    ("Dongri Buzurg", 21.548, 79.682),
    ("Balaghat", 21.966, 80.233),
    ("Chikla", 21.516, 79.750),
    ("Tirodi", 21.683, 79.717),
    ("Ukwa", 21.966, 80.467),
]

def load_positives(ref_profile):
    positives = []
    # 1. From consolidated deposits if available
    if DEPOSITS_JSON.exists():
        with open(DEPOSITS_JSON) as f:
            deps = json.load(f)
        for d in deps:
            lon, lat = d.get("longitude"), d.get("latitude")
            if lon and lat and 78.5 <= lon <= 81.0 and 21.0 <= lat <= 22.5:
                positives.append((d.get("site_name", "Deposit"), lat, lon))
    else:
        # Fallback to MRDS search JSON
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

    # Ensure MOIL mines
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
    rows_pos = []
    for _, r in df_pos.iterrows():
        py, px = rasterio.transform.rowcol(trans, r.lon, r.lat)
        if 0 <= py < height and 0 <= px < width:
            feat_vals = stack[:, py, px]
            if not np.any(np.isnan(feat_vals)) and not np.any(feat_vals == -9999.0):
                rows_pos.append(dict(zip(feat_names, feat_vals), label=1, lat=r.lat, lon=r.lon, name=r["name"]))

    df_pos_samples = pd.DataFrame(rows_pos)
    print(f"Valid positive training points sampled: {len(df_pos_samples)}")

    # 2. Random Background / Unlabeled Negatives (Positive-Unlabeled exploration setup)
    np.random.seed(42)
    n_neg = len(df_pos_samples) * 12 # 1:12 class imbalance
    neg_rows = []
    attempts = 0
    while len(neg_rows) < n_neg and attempts < 100000:
        attempts += 1
        ry = np.random.randint(0, height)
        rx = np.random.randint(0, width)
        rlon, rlat = rasterio.transform.xy(trans, ry, rx)
        # Check buffer from positives (must be > 2.5 km away)
        dist_sq = ((df_pos.lat - rlat)**2 + (df_pos.lon - rlon)**2).min()
        if dist_sq < (0.025)**2:
            continue
        vals = stack[:, ry, rx]
        if not np.any(np.isnan(vals)) and not np.any(vals == -9999.0):
            neg_rows.append(dict(zip(feat_names, vals), label=0, lat=rlat, lon=rlon, name="Background"))

    df_neg_samples = pd.DataFrame(neg_rows)
    print(f"Background training points sampled: {len(df_neg_samples)}")

    df_train = pd.concat([df_pos_samples, df_neg_samples], ignore_index=True)

    # 3. Create Spatial Blocks for CV (to prevent spatial autocorrelation leakage)
    block_size = 0.25 # ~28 km spatial blocks
    df_train["block_y"] = np.floor((df_train.lat - 21.0) / block_size).astype(int)
    df_train["block_x"] = np.floor((df_train.lon - 78.5) / block_size).astype(int)
    df_train["block"] = df_train["block_y"].astype(str) + "_" + df_train["block_x"].astype(str)

    # Spatial Block CV
    gkf = GroupKFold(n_splits=5)
    oof = np.zeros(len(df_train))

    for tr, va in gkf.split(df_train, df_train.label, df_train.block):
        clf = lgb.LGBMClassifier(
            n_estimators=180,
            learning_rate=0.03,
            num_leaves=18,
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
        n_estimators=180,
        learning_rate=0.03,
        num_leaves=18,
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
