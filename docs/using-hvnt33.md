# Using hvnt33

The desktop app's **Case** view (⌘4) is where you review, verify, connect and export; see [apps/desktop](../apps/desktop/README.md). The original web workspace at **http://localhost:4310** (while the server runs) works on the same data, in local mode only.

## Your first investigation

1. Create an investigation with the question you are trying to answer.
2. Add people, organizations, places, events, claims, documents, notes, links, images, or videos. Include source citations and capture originals when available.
3. Open a record and connect it to another. Use a specific relationship such as “owns,” “paid,” “contradicts,” or “supports.” Choose the supporting evidence record and a verification status.
4. Use the connection map to inspect links, drag nodes into an arrangement, and download the map as SVG. Use dated records to build the timeline.
5. Add records and connections to your presentation. Export its ZIP, extract it, and open `index.html`. It works offline. Print it to PDF in your browser, use `connection-map.svg` in a layout/slide tool, or take the CSV, JSON, and media into other tools.

A video URL is a link to the source, not an archived video. To preserve a video, attach the file. Each record accepts one file up to 2 GB; use separate evidence records for multiple attachments. Uploaded originals are copied into `data/vault/` and assigned a SHA-256 checksum. Images and browser-supported video formats can be previewed; other formats remain downloadable. Checksums help detect changed bytes; they do not establish authenticity or truth.

## Verification and presentation

“Unverified,” “Corroborated,” “Verified,” and “Disputed” are your editorial assessments. The app does not automatically verify facts. Connection assessments are independent of the endpoint records. You can edit records and connections as your research develops.

New records and connections default to research-only. A selected export contains:

- Investigation title and description, all selected records, and their complete notes and citations.
- Selected connections only when both endpoints and the supporting evidence (if specified) are also selected.
- Original attachments for selected records, checksums, capture dates, a timeline, and a connection map.
- `index.html`, `connection-map.svg`, `records.csv`, `connections.csv`, `investigation.json`, and `files/`.

Search/filter controls affect the workspace display, not the exported selection. “Export entire investigation” includes every record, connection, and attachment, including research-only material. Selection does not redact text, file contents, or embedded metadata. Review the extracted dossier before distributing it. CSV cells that could be interpreted as spreadsheet formulas are escaped.
