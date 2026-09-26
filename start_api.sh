#!/bin/bash
# Start the API from any directory (same as `make api`). Logs go to backend.log.
cd "$(dirname "$0")" || exit 1
[ -x venv/bin/python ] || { echo "venv missing: run 'make setup' first" >&2; exit 1; }
export PYTHONPATH=backend
exec venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "${API_PORT:-8000}" > backend.log 2>&1
