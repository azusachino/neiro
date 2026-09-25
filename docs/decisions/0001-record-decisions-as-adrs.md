# 0001 record decisions as ADRs

Status: accepted, 2026-09-25.

## context

Until 0.5.0, neiro's rules lived as statements in `AGENTS.md` and as principles and lists in `docs/roadmap.md`. The statements said what to do, and mostly not what had been rejected or why, so a contributor could not tell a deliberate choice from an accident, and changing a rule meant editing it wherever it was restated. The design review that led to 0.6.0 made several decisions at once, some reversing earlier work, which needed a record that outlives the conversation.

## decision

Each decision that bounds later work is an architecture decision record in `docs/decisions/NNNN-<slug>.md`, numbered in the order it was recorded, with a status line and four sections: context, decision, alternatives considered, and consequences. Rules decided before this record existed are backfilled from the roadmap, the commit history, and the issues; where those sources are silent about an alternative or a reason, the record says "not recorded" instead of supplying one.

A record is not edited to change its decision. A new record supersedes it, and the old one's status names its successor. `AGENTS.md` and the roadmap link to the record that owns a rule rather than restating its reasoning; the roadmap keeps order and status.

## alternatives considered

- **Keep the reasons in the roadmap.** Its principles section already held most rules, but it mixes decisions with status, and a milestone's text is rewritten as work moves.
- **Leave reasons in commit messages and issues.** They record the reasoning at the time, but a reader has to know which commit to find.

## consequences

A rule has one home and a visible history. Recording a decision costs a file, and a change that reverses one costs a new record rather than an edit. The backfilled records are only as complete as the history they draw on.
