# syntax=docker/dockerfile:1
#
# WASM language runtimes. Pyodide today; another language is another directory.
#
# Versioned by path (/runtimes/pyodide/v0.26.4/) so a content release never invalidates
# the Pyodide cache on a device that already downloaded it (§12.4).
FROM alpine:3.20 AS fetch

ARG PYODIDE_VERSION=0.26.4
RUN apk add --no-cache curl tar

WORKDIR /out
RUN mkdir -p pyodide/v${PYODIDE_VERSION} wheels \
    && curl -fsSL "https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/pyodide-${PYODIDE_VERSION}.tar.bz2" \
       | tar -xj --strip-components=1 -C "pyodide/v${PYODIDE_VERSION}"

# micropip resolves against PyPI by default, which is an external fetch and therefore
# blocked by design. Every wheel the curriculum needs is vendored here, and the index
# URL is pointed at it through /config.json (§4).
COPY images/runtimes/wheels/ /out/wheels/
RUN printf '<!DOCTYPE html><html><body><h1>wheels</h1></body></html>' > /out/wheels/index.html

# Unprivileged nginx: the stock image runs as root and the chart sets runAsNonRoot.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY images/runtimes/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=fetch /out /usr/share/nginx/html
EXPOSE 8080
