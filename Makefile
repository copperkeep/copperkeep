REGISTRY ?= ghcr.io
NAMESPACE ?= copperkeep
VERSION ?= $(shell grep '^appVersion:' deploy/helm/copperkeep/Chart.yaml | awk '{print $$2}' | tr -d '"')

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: dev
dev: ## Postgres + API + the web dev server
	docker compose -f deploy/compose/docker-compose.yml up -d postgres
	cd apps/api && python -m venv .venv && .venv/bin/pip install -e '.[dev]' && \
		.venv/bin/copperkeep-migrate && \
		.venv/bin/uvicorn copperkeep_api.main:app --reload &
	pnpm --filter @copperkeep/web dev

.PHONY: typecheck
typecheck: ## Typecheck every workspace package
	pnpm -r typecheck

.PHONY: test
test: ## Run the unit tests
	cd apps/api && pytest -q
	node scripts/check-contrast.mjs

.PHONY: lint
lint: ## Lint the Python services
	cd apps/api && ruff check .
	cd apps/tutor && ruff check .

.PHONY: images
images: ## Build every image locally (single-arch)
	docker build -t $(NAMESPACE)/web:$(VERSION) -f apps/web/Dockerfile .
	docker build -t $(NAMESPACE)/api:$(VERSION) -f apps/api/Dockerfile apps/api
	docker build -t $(NAMESPACE)/tutor:$(VERSION) -f apps/tutor/Dockerfile apps/tutor
	docker build -t $(NAMESPACE)/runtimes:$(VERSION) -f images/runtimes/Dockerfile .
	docker build -t $(NAMESPACE)/content-base:$(VERSION) -f images/content/Dockerfile .
	docker build -t $(NAMESPACE)/audio-base:$(VERSION) -f images/audio/Dockerfile .

.PHONY: helm-lint
helm-lint: ## helm lint, both tutor states
	helm lint deploy/helm/copperkeep
	helm lint deploy/helm/copperkeep --values deploy/helm/copperkeep/tests/values-tutor.yaml

.PHONY: helm-template
helm-template: ## Diff the rendered chart against the golden files
	scripts/helm-golden.sh

.PHONY: helm-golden
helm-golden: ## Accept the current rendering as the new golden files
	UPDATE_GOLDEN=1 scripts/helm-golden.sh

.PHONY: smoke
smoke: ## Stand up Compose and run the smoke assertions
	scripts/smoke-compose.sh

.PHONY: e2e
e2e: ## Browser tests against a running instance (BASE=url to override)
	scripts/e2e.sh $(BASE)

.PHONY: compose-up
compose-up: ## Run the published images on this box
	cd deploy/compose && docker compose pull && docker compose up -d
