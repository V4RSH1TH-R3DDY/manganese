from pathlib import Path
import warnings
import morecantile
import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, reproject, transform_bounds
from fastapi import APIRouter, HTTPException, Request, Response

from app.core.config import settings

# Suppress NotGeoreferencedWarning for in-memory PNG tile serialization
warnings.filterwarnings("ignore", category=NotGeoreferencedWarning)

router = APIRouter(prefix="/prospectivity", tags=["prospectivity"])
tms = morecantile.tms.get("WebMercatorQuad")


def get_cog_path() -> Path:
    p = Path(settings.cog_path)
    if p.exists():
        return p
    local_p = Path("data/cogs/prospectivity.tif")
    if local_p.exists():
        return local_p
    raise HTTPException(404, "prospectivity COG not built yet (run scripts/predict_raster.py)")


@router.get("/meta")
def meta(request: Request):
    cog_file = get_cog_path()
    with rasterio.open(cog_file) as src:
        b = transform_bounds(src.crs, "EPSG:4326", *src.bounds)

    base = str(request.base_url).rstrip("/")
    tiles = f"{base}/api/v1/prospectivity/tiles/{{z}}/{{x}}/{{y}}.png"

    return {
        "tiles": tiles,
        "bounds": [round(x, 4) for x in b]
    }


@router.api_route("/tiles/{z}/{x}/{y}.png", methods=["GET", "HEAD"])
def get_tile(z: int, x: int, y: int):
    cog_file = get_cog_path()
    tile = morecantile.Tile(x=x, y=y, z=z)
    bounds = tms.bounds(tile)

    with rasterio.open(cog_file) as src:
        # Check intersection with raster bounds
        if (bounds.right < src.bounds.left or bounds.left > src.bounds.right or
                bounds.top < src.bounds.bottom or bounds.bottom > src.bounds.top):
            empty = np.zeros((4, 1, 1), dtype=np.uint8)
            with MemoryFile() as mem:
                with mem.open(driver="PNG", count=4, width=1, height=1, dtype="uint8") as dst:
                    dst.write(empty)
                return Response(content=mem.read(), media_type="image/png")

        dst_arr = np.full((256, 256), -1.0, dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=dst_arr,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=rasterio.transform.from_bounds(
                bounds.left, bounds.bottom, bounds.right, bounds.top, 256, 256),
            dst_crs="EPSG:4326",
            resampling=Resampling.bilinear
        )

    # Color mapping: inferno heatmap (purple -> magenta -> orange -> intense yellow)
    val = np.clip(dst_arr, 0.0, 1.0)
    valid = (dst_arr >= 0.0)

    rgba = np.zeros((4, 256, 256), dtype=np.uint8)
    rgba[0] = (np.clip(val * 1.5, 0, 1.0) * 255).astype(np.uint8)
    rgba[1] = (np.power(val, 1.6) * 230).astype(np.uint8)
    rgba[2] = ((1 - val) * 140 * valid).astype(np.uint8)
    rgba[3] = (np.clip(val * 1.8, 0, 0.85) * 255 * valid).astype(np.uint8)

    with MemoryFile() as mem:
        with mem.open(driver="PNG", count=4, width=256, height=256, dtype="uint8") as dst:
            dst.write(rgba)
        png_bytes = mem.read()

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"}
    )
