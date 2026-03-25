# fixtures/e2e

E2E test snapshots. Each subdirectory corresponds to one E2E roteiro.

These directories are created and destroyed programmatically by `beforeAll`/`afterAll` in each test.
Never commit runtime state from these directories.

- `e2e-01/` — E2E-01: add input validation
- `e2e-02/` — E2E-02: write unit tests for TaskRepository
- `e2e-03/` — E2E-03: fix planted bug in deleteTask
- `e2e-04/` — E2E-04: refactor TaskController
- `e2e-05/` — E2E-05: add priority field
- `e2e-06/` — E2E-06: governance file protection
