PYTHON ?= python3
NODE ?= node
UV ?= uv
HOST ?= 127.0.0.1
PORT ?= 8765
RT_VENV ?= .venv-sionna-rt
RT_PYTHON_VERSION ?= 3.13
SIONNA_RT_VERSION ?= 2.1.0
SIONNA_RT_PYTHON ?= $(RT_VENV)/bin/python

.PHONY: help setup rt-setup run test test-rt check

help:
	@printf 'Atlas RAN Twin mockup\n'
	@printf '  make setup            Install pinned CesiumJS assets locally with npm ci\n'
	@printf '  make run              Serve this mockup or reuse its existing server at http://$(HOST):$(PORT)/\n'
	@printf '  make test             Run deterministic JavaScript and Python tests\n'
	@printf '  make rt-setup         Install Sionna-RT into an isolated Python 3.13 environment\n'
	@printf '  make test-rt          Run the real Sionna-RT path smoke test\n'
	@printf '  make check            Run model, server, RT geometry tests and JavaScript syntax checks\n'
	@printf '  make run PORT=8766    Use a different port when 8765 is busy\n'

setup:
	npm ci --no-audit --no-fund

run:
	@test -f node_modules/cesium/Build/Cesium/Cesium.js || { printf 'CesiumJS assets are missing. Run make setup first.\n' >&2; exit 1; }
	@SIONNA_RT_PYTHON="$(SIONNA_RT_PYTHON)" $(PYTHON) serve.py --host "$(HOST)" --port "$(PORT)"

test:
	$(NODE) --test model.test.mjs usecases.test.mjs tasks.test.mjs management.test.mjs dm.test.mjs workspaces.test.mjs artifacts.test.mjs hardware-ui.test.mjs radio-ui.test.mjs scene.test.mjs rt-job.test.mjs
	$(PYTHON) -m unittest -q test_serve.py test_rt_worker.py test_storage.py

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

check: test
	@for file in app.mjs model.mjs usecases.mjs usecase-ui.mjs tasks.mjs management.mjs ops-ui.mjs dm.mjs dm-ui.mjs workspaces.mjs artifacts.mjs hardware-workspace.mjs hardware-ui.mjs radio-ui.mjs scene.mjs scene-ui.mjs rt-job.mjs; do \
		$(NODE) --check "$$file" || exit 1; \
	done
