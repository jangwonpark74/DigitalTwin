PYTHON ?= python3
NODE ?= node
HOST ?= 127.0.0.1
PORT ?= 8765

.PHONY: help run test check

help:
	@printf 'Atlas RAN Twin mockup\n'
	@printf '  make run              Serve this mockup or reuse its existing server at http://$(HOST):$(PORT)/\n'
	@printf '  make test             Run deterministic model/use-case/task/management and server tests\n'
	@printf '  make check            Run tests and JavaScript syntax checks\n'
	@printf '  make run PORT=8766    Use a different port when 8765 is busy\n'

run:
	@$(PYTHON) serve.py --host "$(HOST)" --port "$(PORT)"

test:
	$(NODE) --test model.test.mjs usecases.test.mjs tasks.test.mjs management.test.mjs dm.test.mjs workspaces.test.mjs artifacts.test.mjs
	$(PYTHON) -m unittest -q test_serve.py

check: test
	@for file in app.mjs model.mjs usecases.mjs usecase-ui.mjs tasks.mjs management.mjs ops-ui.mjs dm.mjs dm-ui.mjs workspaces.mjs artifacts.mjs; do \
		$(NODE) --check "$$file" || exit 1; \
	done
