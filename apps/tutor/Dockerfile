# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build

WORKDIR /src
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
COPY pyproject.toml README.md ./
COPY copperkeep_tutor ./copperkeep_tutor
RUN python -m venv /opt/venv && /opt/venv/bin/pip install .

FROM python:3.12-slim

RUN useradd --system --uid 65532 --create-home copperkeep
COPY --from=build /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
USER 65532
EXPOSE 8000

CMD ["uvicorn", "copperkeep_tutor.main:app", "--host", "0.0.0.0", "--port", "8000"]
