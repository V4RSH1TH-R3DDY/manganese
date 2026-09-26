# Planning notes (historical)

Early design documents, kept for the reasoning behind the architecture. Some details have since
changed: the app now runs on SQLite with `make` (no Docker required), the API serves the
prospectivity map tiles itself (no TiTiler), and trained models are rebuilt by `make data` rather
than committed. For current instructions see the root `README.md` and `data/README.md`.
