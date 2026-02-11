SHELL := /bin/bash

.PHONY: help
help:
	@echo ""
	@echo "Targets:"
	@echo "  make install            Install all workspace deps"
	@echo "  make clean              Remove build artifacts"
	@echo "  make test               Run all tests"
	@echo "  make build              Build all workspaces"
	@echo "  make dev-all            Run is_form + is_application together"
	@echo "  make is-mapper-map      Run is_mapper UI map"
	@echo "  make is-mapper-dev      Run is_mapper dev mode"
	@echo "  make form-dev           Start is_form server"
	@echo "  make apply-dev          Start is_application server"
	@echo "  make apply-settings     Run apply settings CLI"
	@echo "  make discovery-scan     Run discovery scan CLI"
	@echo "  make db-migrate         Run DB migrations (is_form)"
	@echo "  make db-import-map      Import UI map into DB (is_form)"
	@echo ""

.PHONY: install
install:
	npm install

.PHONY: clean
clean:
	@find . -type d \( -name dist -o -name .cache -o -name .turbo -o -name playwright-report -o -name test-results \) -prune -exec rm -rf {} +
	@rm -rf state
	@echo "Cleaned."

.PHONY: test
test:
	npm test

.PHONY: build
build:
	npm run build

.PHONY: is-mapper-map
is-mapper-map:
	npm -w apps/is_mapper run is_mapper:map

.PHONY: is-mapper-dev
is-mapper-dev:
	npm -w apps/is_mapper run dev

.PHONY: form-dev
form-dev:
	npm -w apps/is_form run form:dev

.PHONY: db-migrate
db-migrate:
	npm -w apps/is_form run db:migrate

.PHONY: db-import-map
db-import-map:
	npm -w apps/is_form run db:import-map

.PHONY: apply-dev
apply-dev:
	npm -w apps/is_application run apply:dev

.PHONY: apply-settings
apply-settings:
	npm -w apps/is_application run apply:settings

.PHONY: discovery-scan
discovery-scan:
	npm -w apps/is_application run discovery:scan

.PHONY: dev-all
dev-all:
	npm run dev:all
