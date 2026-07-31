@AGENTS.md

## Claude Code

`AGENTS.md` above is authoritative and actor-neutral. Only genuinely Claude-Code-specific notes
belong here; do not restate its rules, and do not describe `.claude/agents/` or `.claude/skills/`
— they self-describe and duplicating them wastes context on every turn.

The private knowledge hub section in `AGENTS.md` applies here too — consult `../brain` before
building a shared-domain flow, and write sensitive findings there rather than in this public repo.

### Graphify does not apply here

`graphify-out/` and `scripts/refresh-graphify.py` do not exist in this repository; they are a
parent-ComplyEaze concept. Ignore any inherited instruction to read `graphify-out/GRAPH_REPORT.md`
or run a Graphify refresh here. Use ordinary exploration instead.
