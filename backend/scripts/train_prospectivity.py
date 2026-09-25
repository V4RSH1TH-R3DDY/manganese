"""Module A training: prospectivity classifier with SPATIAL BLOCK CV.

Random CV leaks across neighbouring pixels and gives fake 0.99 AUCs. Always
block by a coarse lon/lat grid. This is positive-unlabeled learning (negatives
are pseudo-absences drawn outside a buffer around known deposits), so report
AUC-PR and "% of known deposits captured in the top 10% of area", not accuracy.

Outputs:
  - artifacts/prospectivity.joblib
  - backend/artifacts/prospectivity.joblib (consumed by scripts/predict_raster.py)
"""

from pathlib import Path
import sys

# Import main pipeline implementation
pipeline_dir = Path(__file__).resolve().parents[2] / "pipelines"
if str(pipeline_dir) not in sys.path:
    sys.path.insert(0, str(pipeline_dir))

from train_prospectivity import main as pipeline_main


def main():
    pipeline_main()


if __name__ == "__main__":
    main()
