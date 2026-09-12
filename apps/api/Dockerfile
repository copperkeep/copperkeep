# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build

WORKDIR /src
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
COPY pyproject.toml README.md ./
COPY copperkeep_api ./copperkeep_api
RUN python -m venv /opt/venv && /opt/venv/bin/pip install .

# The plan targets distroless. distroless/python3-debian12 pins 3.11 and does not carry
# a venv cleanly, so this uses slim with a non-root user instead; revisit when the
# distroless image catches up.
FROM python:3.12-slim

RUN useradd --system --uid 65532 --create-home copperkeep
COPY --from=build /opt/venv /opt/venv
COPY migrations /app/migrations

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    COPPERKEEP_MIGRATIONS_DIR=/app/migrations

WORKDIR /app
USER 65532
EXPOSE 8000

CMD ["uvicorn", "copperkeep_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
