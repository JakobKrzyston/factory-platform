# platform

Shared by every factory: the factory reader (`factory/`), queue, run log, gate runner, replay harness, scorers (`scorers/`), dashboard. `scripts/run-issue.sh` runs an agent by the contract its `agent.md` names, never by its name (TL-18), and the tests here use factories of their own, so they pass with `factories/` empty. The one exception is the replay harness (`bench/`), which still chains a benchmark case's stages by the code factory's agent names.
