# Self-hosted fonts

The four faces — Inter, Inter Tight, JetBrains Mono, Atkinson Hyperlegible — are all
SIL OFL and are **self-hosted in this image**. There is no font CDN: `require-corp`
would block one silently, and CI fails the build on an external subresource
(§11.6).

They are not committed here. Run `scripts/fetch-fonts.sh` once to vendor them into this
directory, then add one line to `apps/web/index.html`:

```html
<link rel="stylesheet" href="/fonts/fonts.css" />
```

The link is not there by default so that a fresh clone does not 404 on every page load.

Until they are vendored, `tokens.css` falls back to system stacks — the page is legible
and correctly laid out, it just is not wearing the house type.
