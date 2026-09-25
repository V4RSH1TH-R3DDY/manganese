"""Extract and generate geophysical and structural feature rasters for Module A."""

from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.transform import from_bounds as transform_from_bounds
from scipy import ndimage as ndi

EMAG_PATH = Path("data/EMAG2_V3_UpCont_DataTiff.tif")
FEATURE_DIR = Path("data/features")
FEATURE_DIR.mkdir(parents=True, exist_ok=True)

# Target belt bounds (Nagpur-Bhandara-Balaghat Manganese Belt)
MIN_LON, MAX_LON = 78.5, 81.0
MIN_LAT, MAX_LAT = 21.0, 22.5

def main():
    print("Reading EMAG2 raster...")
    with rasterio.open(EMAG_PATH) as src:
        # EMAG2: bounds (-0.0166, -89.983, 359.983, 89.983)
        win = from_bounds(MIN_LON, MIN_LAT, MAX_LON, MAX_LAT, src.transform)
        mag_raw = src.read(1, window=win)
        win_transform = src.window_transform(win)

    # Clean nodata
    nodata_mask = (mag_raw < -1e10) | np.isnan(mag_raw)
    mag = mag_raw.copy()
    if np.any(nodata_mask):
        mag[nodata_mask] = np.nanmedian(mag[~nodata_mask])

    print(f"Cropped raw shape: {mag.shape}")

    # Upsample slightly to 0.01 degree (~1km) for smooth exploration surface
    target_h = int((MAX_LAT - MIN_LAT) / 0.01)  # 150 cells
    target_w = int((MAX_LON - MIN_LON) / 0.01)  # 250 cells
    zoom_y = target_h / mag.shape[0]
    zoom_x = target_w / mag.shape[1]
    mag_grid = ndi.zoom(mag, (zoom_y, zoom_x), order=3)

    affine_trans = transform_from_bounds(MIN_LON, MIN_LAT, MAX_LON, MAX_LAT, target_w, target_h)

    # Compute geophysics & structural derivatives
    # 1. Gradients
    gy, gx = np.gradient(mag_grid)
    grad_mag = np.sqrt(gx**2 + gy**2)

    # 2. Analytic signal approx (3D gradient magnitude)
    gz = ndi.laplace(mag_grid)
    analytic_signal = np.sqrt(gx**2 + gy**2 + gz**2)

    # 3. Local curvature / structural roughness
    curvature = ndi.gaussian_laplace(mag_grid, sigma=1.5)

    # 4. Structural lineaments & distance to magnetic contacts
    lineament_mask = grad_mag > np.percentile(grad_mag, 80)
    dist_to_contact = ndi.distance_transform_edt(~lineament_mask) * 0.01 * 111.0 # approx km

    features = {
        "01_mag_anomaly.tif": mag_grid.astype("float32"),
        "02_mag_grad_x.tif": gx.astype("float32"),
        "03_mag_grad_y.tif": gy.astype("float32"),
        "04_mag_grad_mag.tif": grad_mag.astype("float32"),
        "05_mag_analytic_signal.tif": analytic_signal.astype("float32"),
        "06_mag_curvature.tif": curvature.astype("float32"),
        "07_dist_to_contact_km.tif": dist_to_contact.astype("float32"),
    }

    prof = {
        "driver": "GTiff",
        "height": target_h,
        "width": target_w,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:4326",
        "transform": affine_trans,
        "nodata": -9999.0
    }

    print("Writing feature rasters to", FEATURE_DIR)
    for fname, arr in features.items():
        out_path = FEATURE_DIR / fname
        with rasterio.open(out_path, "w", **prof) as dst:
            dst.write(arr, 1)
        print(f"  Saved {fname}: shape={arr.shape}, range=[{arr.min():.2f}, {arr.max():.2f}]")

if __name__ == "__main__":
    main()
