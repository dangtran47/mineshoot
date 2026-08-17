# CLAUDE.md

@AGENTS.md

The shared agent guide above (commands, conventions, definition of done, code
map, gotchas) is the source of truth. This file only adds Claude Code specifics.

## Claude Code notes

- **Start of a task:** skim `AGENTS.md`; open `docs/ARCHITECTURE.md` when the
  task touches networking, the room, physics/combat rules or bots.
- **Verification before claiming done:** run `npm test` and `npm run build`
  and paste the tail of the output. For UI/network changes also run
  `npm run smoke` (server started with `MINESHOOT_TEST=1 make server`, client
  with `make client`). If the smoke test can't run in this environment, say so
  instead of implying it passed.
- **Headless browser checks:** prefer `npm run smoke` (playwright-core +
  swiftshader) over the Chrome extension tools; the extension is often not
  connected in this environment.
- **Long-running processes:** start `make start` in the background and stop it
  when finished; do not leave a dev server running across tasks.
- **Git:** work on `main` unless told otherwise; do not commit, push or deploy
  unless explicitly asked. Deploys are `make deploy-fe` / `make deploy-be` and
  are outward-facing — always confirm first.
- **README is part of the change:** gameplay numbers and rules in `README.md`
  must match `packages/shared/src/{constants,melee,bot}.ts` after your edit.
- **Docs upkeep:** if you change a command, a package layout, an env var or a
  rule listed in `AGENTS.md`/`docs/ARCHITECTURE.md`, update that file in the
  same change.
