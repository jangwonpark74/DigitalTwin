PYTHON ?= python3
NODE ?= node
UV ?= uv
HOST ?= 127.0.0.1
PORT ?= 8765
AUTO_PORT ?= $(if $(filter file,$(origin PORT)),1,0)
RT_VENV ?= .venv-sionna-rt
RT_PYTHON_VERSION ?= 3.13
SIONNA_RT_VERSION ?= 2.1.0
SIONNA_RT_PYTHON ?= $(RT_VENV)/bin/python

.PHONY: help setup rt-setup run test test-rt typecheck ui-test frontend-integration build e2e check

help:
	@printf 'Atlas RAN Twin mockup\n'
	@printf '  make setup            Install pinned runtime and frontend development dependencies\n'
	@printf '  make run              Build and serve the React app and local API (first free port from $(PORT))\n'
	@printf '  make test             Run deterministic JavaScript and Python tests\n'
	@printf '  npm run dev           Start the Vite development server for the React app\n'
	@printf '  npm run test:e2e      Run the Playwright browser smoke tests\n'
	@printf '  make rt-setup         Install Sionna-RT into an isolated Python 3.13 environment\n'
	@printf '  make test-rt          Run the real Sionna-RT path smoke test\n'
	@printf '  make check            Run tests, strict TypeScript checks, Vite build and JavaScript syntax checks\n'
	@printf '  make run PORT=8766    Use a different port when 8765 is busy\n'
	@printf '  Windows 11: npm run setup, npm start, npm run check (no Make required)\n'

setup:
	npm run setup

run: build
	@SIONNA_RT_PYTHON="$(SIONNA_RT_PYTHON)" $(PYTHON) serve.py --host "$(HOST)" --port "$(PORT)" $(if $(filter 1,$(AUTO_PORT)),--port-fallback)

test:
	ATLAS_PYTHON="$(PYTHON)" $(NODE) scripts/atlas.mjs test

typecheck:
	npm run typecheck

ui-test:
	npm run test:ui

frontend-integration:
	npm run test:integration

build:
	npm run build

e2e:
	npm run test:e2e

rt-setup:
	$(UV) venv --allow-existing --python "$(RT_PYTHON_VERSION)" "$(RT_VENV)"
	$(UV) pip install --python "$(RT_VENV)/bin/python" "sionna-rt==$(SIONNA_RT_VERSION)"

test-rt:
	@if [ ! -x "$(SIONNA_RT_PYTHON)" ]; then \
		printf 'Sionna-RT Python not found: %s\n' "$(SIONNA_RT_PYTHON)" >&2; \
		printf 'Run `make rt-setup` or set SIONNA_RT_PYTHON to an installed Sionna-RT interpreter.\n' >&2; \
		exit 2; \
	fi
	SIONNA_RT_PYTHON="$(SIONNA_RT_PYTHON)" $(PYTHON) -m unittest -q test_rt_integration.py

check: test typecheck ui-test frontend-integration
	@for file in activity-ui.mjs stack-ui.mjs ue-ui.mjs drive-workspace-ui.mjs model.mjs usecases.mjs usecase-ui.mjs tasks.mjs management.mjs ops-ui.mjs dm.mjs dm-ui.mjs workspaces.mjs artifacts.mjs hardware-workspace.mjs hardware-ui.mjs radio-ui.mjs scene.mjs scene-ui.mjs rt-job.mjs; do \
		$(NODE) --check "$$file" || exit 1; \
	done
