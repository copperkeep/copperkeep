# Vendored wheels

Pure-Python wheels that Section C lessons import, served as micropip's package index.

`micropip` resolves against PyPI by default. That is an external fetch, which the
on-premise design forbids and `require-corp` would block anyway — so every wheel a
lesson needs is copied here and `micropipIndexUrl` in `/config.json` points at
`/runtimes/wheels/`.

The allowed package list is part of the curriculum manifest, so curriculum CI fails on a
lesson that imports something not shipped here. Adding a package is two commits: the
wheel here, the name in the manifest.
