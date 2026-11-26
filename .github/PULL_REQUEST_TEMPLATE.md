# MAOMAO task PR

## Task
- Task ID:
- Exact behavior:
- Risk lane: F1 / F2 / F3 / F4
- QA baseline SHA:
- Files owned:
- Non-goals:
- Dependencies:

## Verification
- Required GitHub check names (exact):
- Local commands and results:
- Browser/device checks:
- Data/storage impact:
- Rollback:

## Task registry

After the final commit is pushed, register or refresh this PR's machine-readable task record:

    npm run eng:register -- <PR-number> <TASK-ID> <QA-baseline-SHA> <F1|F2|F3|F4> "<exact test check name>" ["<another exact check name>"]

Run the command again after any new commit so the recorded head SHA stays current. The batch coordinator only includes an open, non-draft PR with an approval on its exact current head, all named GitHub checks successful, a complete changed-file match, and a base that is already contained in the deployed QA baseline. Registration does not approve, merge, or deploy anything.
