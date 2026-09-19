---
name: investigation-explore
description: Explore existing hvnt33 research to trace sourced relationships, build a chronology, compare accounts, find contradictions and identify unanswered questions. Use for questions about an investigation, not intake filing or generic database administration.
---

# Explore an investigation

Read the actual persisted case, not recollections from earlier conversation. Resolve its ID with `npm run research -- investigations`, then use `snapshot --case ID` for records and connections. `context --case ID` contains records only. For a source or filing question, inspect `show --intake ID`.

Trace a finding through its `sourceId`/`evidenceId`, `sourceQuote`, original capture and verification status. Distinguish source “mentions” edges from substantive relationships. Graph adjacency does not establish causation or a new relationship; several claims repeated from one source are not independent corroboration.

Preserve attribution, conflicting accounts and date precision. Undated material stays undated. Same-name entities remain separate unless identity is supported. Label assistant observations and transcriptions as derivatives. Identify where source access, originals, dates or identities are missing.

Answer the user's specific question with record/source references and important uncertainty. For hypotheses, explain the supported path and what evidence would test it. Keep hypotheses out of the persisted fact graph unless the user asks to file them as attributed, unverified research. Do not silently upgrade verification status.

Use a map, chronology or comparison when it clarifies the question. Keep navigation to the relevant subset; the workspace/map export caps displays at 70 nodes, so inspect complete JSON rather than treating that view as the whole investigation. Creating a reusable presentation is the output skill's task.
