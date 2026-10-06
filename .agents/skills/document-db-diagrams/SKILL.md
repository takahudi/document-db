---
name: document-db-diagrams
description: Generate or update Diagram Design figures in this document repository, converting annotated HTML into editable diagram definitions and saving through its MCP tools.
---

Use Diagram Design for the requested static figure. Read [the generation contract](references/contract.md) before generating source or replacing a saved figure. Keep ordinary document prose in the repository's existing body parts.

For an update, retrieve the latest `get_document` and `get_diagram` results first. Use their current text and retain diagram, label and slot identities for unchanged meanings. Include the retrieved revision when saving. A conflict requires fetching the current document again before constructing the replacement.

Generate annotated HTML plus its explicit manifest. Run the repository converter with the source, manifest, output path and title. Its successful JSON output contains the exact `title`, `html` and `diagrams` fields for `create_document`. For `update_document`, combine those fields with the current document ID and revision and preserve the rest of the document's compact HTML. Use the connected document repository MCP tools to save when the user has authorized that external write. Then retrieve the saved document and diagram and verify their label values and revision.

Ordinary prose edits reuse the saved figure references and omit replacement definitions. Layout changes replace the affected definition. A user may supply unapplied text after overflow; incorporate that requested text into the regenerated figure while retaining the latest saved surrounding content. Conversion failure means regenerate the indicated source element; a partial output is not a saved diagram.
