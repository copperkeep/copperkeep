# Self-hosted fonts

The four faces — Inter, Inter Tight, JetBrains Mono, Atkinson Hyperlegible — are all
SIL OFL 1.1 and are **committed here and served from this image**. There is no font
CDN: `require-corp` would block one silently, and CI fails the build on an external
subresource (§11.6).

`fonts.css` is linked from `apps/web/index.html`. Atkinson Hyperlegible is what the
"Easier letters" toggle switches prose to (`[data-font="dyslexia"]` in `tokens.css`) —
without it that toggle changes nothing visible.

To refresh or add a face, edit and re-run `scripts/fetch-fonts.sh`, which also fetches
each family's licence (`LICENSE-*.txt`). OFL requires those to ship with the fonts.
