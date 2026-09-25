#!/bin/bash
source /home/varshith/Manganese/venv/bin/activate
export PYTHONPATH=/home/varshith/Manganese/backend
cd /home/varshith/Manganese
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /home/varshith/Manganese/backend.log 2>&1
