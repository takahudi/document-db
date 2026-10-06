# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `takahudi/document-db`. Use the `gh` CLI from this clone.

## Conventions

- Read an issue: `gh issue view <number> --comments`.
- List issues: `gh issue list --state open --json number,title,body,labels` with the appropriate label and state filters.
- Create an issue: `gh issue create --title "..." --body-file <path>`.
- Comment on an issue: `gh issue comment <number> --body-file <path>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`. Use the vocabulary in `docs/agents/triage-labels.md`.
- Close an issue: `gh issue close <number> --comment "..."`.

For multiline bodies, write the exact text to a local UTF-8 file and use `--body-file`.
Obtain explicit user authorization before changes to GitHub, including creating issues, commenting, changing labels, assigning tickets, or closing issues.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Set this flag to `yes` if external PRs should enter the issue triage workflow. When enabled, use `gh pr view`, `gh pr diff`, `gh pr list`, and the corresponding comment, label, and close commands. Keep external authors with association `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE`.

GitHub shares issue and PR numbers. Resolve an ambiguous `#<number>` with `gh pr view <number>`, then fall back to `gh issue view <number>`.

## Skill operations

When a skill says to publish to the issue tracker, prepare a GitHub issue and obtain authorization before creating it. When it says to fetch a ticket, run `gh issue view <number> --comments`.

## Wayfinding operations

The map is one issue with child issues as tickets.

- Map: label it `wayfinder:map`; its body contains Notes, Decisions-so-far, and Fog.
- Child ticket: link it as a GitHub sub-issue. If sub-issues are unavailable, use a task list in the map and put `Part of #<map>` at the top of the child body. Label it `wayfinder:<type>` with type `research`, `prototype`, `grilling`, or `task`.
- Blocking: use native issue dependencies. Add a blocker with `gh api --method POST repos/takahudi/document-db/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Obtain the numeric database ID with `gh api repos/takahudi/document-db/issues/<blocker> --jq .id`. If dependencies are unavailable, use a `Blocked by: #<number>, #<number>` line in the child body.
- Frontier: inspect the map's open children. Exclude assigned tickets and tickets with open blockers. The first remaining ticket in map order wins.
- Claim: assign the ticket with `gh issue edit <number> --add-assignee @me` before starting implementation, after authorization.
- Resolve: comment with the answer, close the ticket, then append a summary and link to the map's Decisions-so-far.
