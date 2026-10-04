# Issue tracker: Local Markdown

Issues and specs live as Markdown files under `.scratch/`.

## File conventions

- Feature directory: `.scratch/<feature-slug>/`.
- Specification: `<feature-directory>/spec.md`.
- Tickets: `<feature-directory>/issues/<NN>-<slug>.md`, numbered
  from `01`, with one file per ticket.
- Record triage state as `Status:` near the top; use the values
  in `docs/agents/triage-labels.md`.
- Append conversation history under `## Comments`.

## Skill operations

To publish a spec or ticket, create its corresponding file.
To fetch a ticket, read the referenced path. Resolve a bare ticket
number within the relevant feature; ask when it is ambiguous.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`, containing Notes,
  Decisions-so-far, and Fog.
- Children: `issues/<NN>-<slug>.md`, with a `Type:` of
  research, prototype, grilling, or task.
- Dependencies: record `Blocked by: NN, NN`; all listed tickets
  must be resolved before work starts.
- Frontier: select the first ticket by number that is unresolved,
  unclaimed, and unblocked.
- Claim: save `Status: claimed` before beginning work.
- Resolve: append `## Answer`, save `Status: resolved`, and add
  a summary and ticket link to the map's Decisions-so-far.

The claimed/resolved values are wayfinding lifecycle states,
separate from the five triage roles.
