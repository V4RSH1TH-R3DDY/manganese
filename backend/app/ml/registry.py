"""Models are artifacts, not code paths. Retraining never touches the API."""

from functools import lru_cache
from pathlib import Path

import joblib
import shap

from app.core.config import settings


def _find_model_path(name: str) -> Path:
    candidates = [
        Path(settings.model_dir) / f"{name}.joblib",
        Path("artifacts") / f"{name}.joblib",
        Path("backend/artifacts") / f"{name}.joblib",
        Path("/app/artifacts") / f"{name}.joblib",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


@lru_cache(maxsize=8)
def load(name: str):
    return joblib.load(_find_model_path(name))


@lru_cache(maxsize=1)
def explainer():
    return shap.TreeExplainer(load("shortfall")["q"][0.5])
