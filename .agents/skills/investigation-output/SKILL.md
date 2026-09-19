---
name: investigation-output
description: Turn existing hvnt33 investigation records into source-linked maps, timelines, evidence dossiers and reusable presentation components. Use when the user asks to make an artifact from research; use the available format-specific skill for slide decks, documents, PDFs or spreadsheets.
---

# Produce investigation outputs

Resolve the case and inspect `npm run research -- snapshot --case ID`. Work from persisted records/relationships and their sources. Infer format and scope from the request; ask only if a consequential audience or selection choice is unclear.

For the existing offline dossier and component bundle:

```sh
npm run research -- export --case CASE_ID --scope selected --output data/exports/story-components.zip
```

`selected` exports records marked for presentation and selected connections only when both endpoints and their supporting evidence are included. `all` includes private research and originals; use it for a requested private working bundle, not as an implicit public selection. Export files use exclusive creation; choose a new filename rather than overwrite an existing artifact. Search filters do not change export scope.

The ZIP contains offline `index.html`, `connection-map.svg`, `records.csv`, `connections.csv`, `investigation.json` and original attachments. Dossier SVGs are limited to 70 nodes; JSON/CSV preserve the complete selected set. For a focused custom map or timeline, select relevant records from the complete snapshot rather than misleadingly treating the capped diagram as complete. Preserve record IDs and source references in derived components.

For a deck, document, PDF or workbook, use the corresponding available artifact skill and its validation. Choose a visual structure appropriate to the research question, with legible labels, citations and explicit uncertainty. Do not decorate an allegation into an established fact, convert an unknown date to a precise one, or imply that graph paths prove relationships not supported by sources.

Generating a local working artifact does not publish it or change database publication/verification flags. Do not automatically select all research for presentation. Inspect generated contents and references; deliver the actual artifact/components with a brief explanation of scope and gaps.
