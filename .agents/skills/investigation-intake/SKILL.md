---
name: investigation-intake
description: File material dropped into the hvnt33 investigation chat—images, notes, article links, documents, transcripts or hvnt33 Desktop browser captures (intake IDs)—into source-linked ArcadeDB records and connections. Use for research intake and sorting, not application development or presentation creation.
---

# File investigation material

The chat is the intake interface. Organize and file supplied material directly; the user checks afterward. Do not substitute a form, approval queue or request for JSON. For the exact commands, draft fields and provenance types, read [the filing contract](references/filing.md).

hvnt33 Desktop sends browser captures by reference: `[hvnt33 capture <intake ID>: <kind> from <site>]`, one or more per message, often followed by the researcher's instruction. Each intake already belongs to a case (`investigationId`); do not capture it again. Read each with `show --intake ID` and continue from extraction, following the browser-capture notes in the filing contract.

Determine the case from conversation and `npm run research -- investigations`; inspect existing entities with `context --case ID`. If no case exists and the subject is clear, create one with `create-case`. Ask only when the case is materially ambiguous.

Preserve original text and attribution before extracting records. Inspect supplied images and accessible documents; retrieve public linked content when needed. If a source cannot be read, file it as a source/link with the access gap recorded, not invented facts. Archive original file bytes when an accessible attachment path exists; otherwise explicitly state that only chat observations were preserved.

Extract entities, dated events, attributed claims and supported relationships. Keep observations, reported statements and inference distinct; retain contradictions and open questions. Image-derived observations and transcriptions must use the corresponding content-origin flag. A quote of captured observation notes is not a quotation purportedly printed in a photo.

Stage the structured extraction, inspect entity-match candidates and file it using the CLI. Reuse an entity only when identity is supported, not merely because a name matches. Leave ambiguous identities separate. Verify the persisted filing; report additions and consequential uncertainty briefly.

Agent filing preserves sources and creates Unverified research records, not publication approval or fact verification. Do not upgrade statuses or overwrite existing entity notes. Stop and report a persistent extraction or filing error without claiming success; repair recoverable data-format errors against the saved source. After an ambiguous filing response, inspect intake state before retrying.
