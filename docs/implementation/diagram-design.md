# Diagram Design integration design

## Problem and usage

The canonical Tiptap JSON gains a diagram atom containing validated SVG, presentation CSS and an explicit label manifest. Text exists only in the SVG. A converter prepares MCP input from annotated HTML and a sidecar. Browser label edits modify the current SVG; AI reads the current definition before layout replacement. Ordinary prose updates retain diagram refs without resending source.

`create_document({title,html,diagrams})` accepts narrow figure refs and new definitions. `update_document({id,revision,title,html,diagrams?})` resolves omitted definitions against the transaction-bound current body. `get_document` returns compact HTML and summaries; `get_diagram({id,diagramId})` returns current revision and full definition.

## Data shape and responsibilities

Diagram `{version:1,id:UUID,description,svg,css,labels}`. Each label `{id,name,frame,slots,decorations}`. Each slot `{id,name,element,region:{x,y,width,height},lineHeight,align}`. The slot element is a SVG group with plain text line children, effective presentation style, and `data-break-before="none|soft|hard"`. Current values derive from source text. Fixed colored symbols and differently styled runs remain separate declared slots or decorations. Coordinates of region are local to the slot group. No copied label string is stored in the manifest.

`src/content/diagram.ts` owns schemas, strict XML/CSS/ID/font validation, source operations and summaries. `src/content/diagram-fonts.ts` owns local font inventory. `src/web/diagram.tsx` owns browser isolation, selection and real-font wrapping and bounds. Session owns unapplied slot values so editor remounts cannot clear them. Existing documents module owns transactions and current-body ref resolution. Shared parts owns atomic schema, while UI attaches a browser-only NodeView.

Iframe isolation uses no script permission and a strict CSP. Static geometry, local paint references and presentation styles are permitted. All scripting, remote resources, unsafe namespaces/at-rules and undeclared fonts are rejected. Trusted local font CSS is generated separately. The complete JSON snapshot already covers restore and restart without DB migration.

## Synthesis decision

Parent chose the validated raw SVG candidate over a fully typed scene graph. It preserves the complete static drawing through a smaller public format while enforcing static XML/CSS at one parse boundary. A scene graph would require callers and converters to reconstruct many primitive/style relationships. Both candidates agreed on explicit slots and Session-owned unapplied drafts.

Adapt the typed-tree candidate's grapheme-aware wrapping, explicit styled-run editing and retained unresolved drafts. Use real computed SVG geometry in the isolated document; do not use character-count estimates. Candidate AST is private runtime state, never an additional persisted source.

Three configured design seats were attempted; thread capacity limited the panel to gpt-6-astra @xhigh and gpt-6.1-sol @high. The cross-judge used an existing independent gpt-6.1-sol @medium slot because a new configured pool seat was unavailable.

The independent judge scored raw SVG 15/15 and typed AST 13/15, agreeing with the base selection. It required unambiguous slot ownership, exact text reconstruction and painted bounds as validation rules. It also required deleted-target drafts to remain visible until explicit discard. These are part of the implementation contract.

Font files come from pinned Fontsource packages, served through local HTTP routes in both development and production. The accepted face inventory in `diagram-fonts.ts` is the source of truth for font validation and asset delivery. This avoids duplicating font binaries in the repository while keeping runtime independent of external font services.

## Implementation reconciliation

Contracts are implemented in verifiable units: canonical diagram and hostile-input tests; transactional codec/MCP integration; browser fitting/draft lifetime/fonts; converter/skill and end-to-end verification. No changes to the approved user editing scope.

Each slot uses its own local coordinates. Multiple source lines must share one parent frame; CSS transforms are refused with a regeneration diagnostic, while SVG transform attributes preserve rotated labels. All computed presentation values, including normal typography, are frozen onto the converted source. Simple one-line HTML labels convert to SVG; richer HTML requests regeneration. Cleared labels stay valid through conversion and browser edits.

The font catalog supplies actual package assets through local routes. Japanese text requires Noto Sans JP in its declared family stack. The real-browser verifier additionally inspects platform fonts to prove Japanese glyphs use custom packaged faces rather than system substitution. Parent and reviewers reproduced CSS-style loss, coordinate relocation and the stale disabled UI state, then added regression tests and the explicit generation restrictions.

The body-codec and ordinary MCP verification schema now account for the diagram atom and summaries. Ordinary prose continues to use the same strict grammar. No DB migration or alternate source is introduced.

## Proof

Baseline `npm test` passed seven existing tests before changes. The full suite passed 28 tests with typecheck, lint and production build. After the final UI lifecycle changes, the four session tests and both real-browser scenarios passed again. The diagram verifier uses actual SQLite, HTTP, stdio MCP and Edge to check label edits, overflow input retention, revision refusal, restore, restart, offline fonts and multiple-diagram isolation. It also saves converter output, edits chart values and rotated labels, applies an AI layout update and edits a converted HTML label. CDP verifies packaged Japanese fonts after all network-dependent operations finish. Invalid definitions leave current/previous/revision unchanged.

Run `npm run verify:diagrams` for the full gate and `node --import tsx scripts/verify-mvp.ts` for the existing product scenario after build. Generated outcomes are `verification-artifacts/diagrams/result.json` and `verification-artifacts/measurement.json`; the scripts recreate them in isolated temporary data directories. The PR includes `docs/images/diagram-editor.png` from the actual browser run.
