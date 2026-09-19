// Every server call the app makes, through the client generated from the
// server's OpenAPI description (@hvnt33/api-client). Paths, parameters and
// request bodies are checked against the server's contract at compile time.
import { invoke } from "./native";
import { createClient, unwrap } from "@hvnt33/api-client";
import type { ArchiveHistory, ArchiveJob, CaseNetwork, Connection, Dossier, IntakeSummary, Investigation, OwnSnapshot, PageChange, PageVisit, RecordItem, SavedSearch, SearchRun, SerpResult, Watch } from "@hvnt33/core/events";

/**
 * Transport: requests go through the native bridge (`api` command), which
 * adds the API token and talks to the configured server. The webview never
 * holds the token or reaches the network directly.
 */
const bridgeFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const reply = await invoke<{ status: number; body: unknown }>("api", { method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) : null });
  const empty = reply.body === null || reply.status === 204;
  return new Response(empty ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
};

/** A change to a case's network: a route, or Tor; optionally a login for the route (null removes it). */
export type NetworkChange = Pick<CaseNetwork, "route" | "label" | "lock"> & { tor?: boolean; credentials?: { username: string; password: string } | null };

export const client = createClient({ baseUrl: "http://hvnt33.bridge", fetch: bridgeFetch });

const id = (value: string) => ({ params: { path: { id: value } } });

// Response bodies are loose objects on the wire; the app works with the
// domain types in @hvnt33/core, which name the fields it relies on.
export const data = {
  health: () => unwrap(client.GET("/api/health")),
  workspace: () => unwrap(client.GET("/api/workspace")),

  investigations: async () => (await unwrap(client.GET("/api/investigations"))) as unknown as Investigation[],
  archivedInvestigations: async () => (await unwrap(client.GET("/api/investigations/archived"))) as unknown as Investigation[],
  createInvestigation: async (title: string, description: string) => (await unwrap(client.POST("/api/investigations", { body: { title, description } }))) as unknown as Investigation,
  updateInvestigation: async (investigationId: string, body: { title?: string; description?: string; network?: NetworkChange }) =>
    (await unwrap(client.PATCH("/api/investigations/{id}", { ...id(investigationId), body }))) as unknown as Investigation,
  archiveInvestigation: async (investigationId: string) => (await unwrap(client.DELETE("/api/investigations/{id}", id(investigationId)))) as unknown as Investigation,
  restoreInvestigation: async (investigationId: string) => (await unwrap(client.POST("/api/investigations/{id}/restore", id(investigationId)))) as unknown as Investigation,
  /** The proxy address the case's tabs use: its route, or its local relay when the route logs in (Tor, a password). */
  caseRoute: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/route", id(investigationId)))).route,
  torStatus: () => unwrap(client.GET("/api/network/tor")),
  /** Tor: a new circuit and exit for the case. */
  newExit: (investigationId: string) => unwrap(client.POST("/api/investigations/{id}/new-exit", id(investigationId))),
  dossier: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}", id(investigationId)))) as unknown as Dossier,

  intakes: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/intakes", id(investigationId)))) as unknown as IntakeSummary[],
  intake: (intakeId: string) => unwrap(client.GET("/api/intakes/{id}", id(intakeId))),
  /** File a staged extraction as the researcher (selected proposals, optional reuse of existing records), or reject it. */
  reviewIntake: (intakeId: string, body: { reject?: boolean; records?: { id: string; reuseId?: string }[]; connections?: { id: string }[] }) =>
    unwrap(client.POST("/api/intakes/{id}/review", { ...id(intakeId), body: { mode: "researcher", ...body } })),

  // Records and connections: editing is the researcher's work; changing a
  // verification status (or reviewed: true) records a review.
  createRecord: async (body: { investigationId: string; title: string; kind: RecordItem["kind"]; status?: string; notes?: string; sourceUrl?: string; sourceLabel?: string; eventDate?: string; tags?: string; public?: boolean }) =>
    (await unwrap(client.POST("/api/records", { body: body as never }))) as unknown as RecordItem,
  updateRecord: async (recordId: string, body: Partial<{ title: string; status: string; notes: string; sourceUrl: string; sourceLabel: string; eventDate: string; tags: string; public: boolean; reviewed: boolean }>) =>
    (await unwrap(client.PATCH("/api/records/{id}", { ...id(recordId), body: body as never }))) as unknown as RecordItem,
  deleteRecord: (recordId: string) => unwrap(client.DELETE("/api/records/{id}", id(recordId))),
  createConnection: async (body: { fromId: string; toId: string; label: string; status?: string; notes?: string; evidenceId?: string; public?: boolean }) =>
    (await unwrap(client.POST("/api/connections", { body: body as never }))) as unknown as Connection,
  updateConnection: async (connectionId: string, body: Partial<{ label: string; status: string; notes: string; evidenceId: string; public: boolean; reviewed: boolean }>) =>
    (await unwrap(client.PATCH("/api/connections/{id}", { ...id(connectionId), body: body as never }))) as unknown as Connection,
  deleteConnection: (connectionId: string) => unwrap(client.DELETE("/api/connections/{id}", id(connectionId))),
  /** A record's evidence image as a data URL, for previews. */
  recordImage: (recordId: string) => invoke<string>("api_image", { path: `/api/files/${recordId}` }),
  /** Save a record's evidence original to ~/Downloads. */
  downloadRecordFile: (r: RecordItem) => invoke<string>("api_download", { path: `/api/files/${r.id}?download=1`, fileName: r.filename || `${r.title}.bin` }),
  /** Save the presentation (selected records) or the entire case as a portable ZIP to ~/Downloads. */
  exportCase: (inv: Investigation, scope: "selected" | "all") =>
    invoke<string>("api_download", { path: `/api/investigations/${inv.id}/export${scope === "all" ? "?scope=all" : ""}`, fileName: `hvnt33 ${inv.title.slice(0, 60)} ${scope === "all" ? "full" : "presentation"} ${new Date().toISOString().slice(0, 10)}.zip` }),
  saveText: (fileName: string, content: string) => invoke<string>("save_text", { fileName, content }),

  searches: async (investigationId: string, limit = 2000) =>
    (await unwrap(client.GET("/api/investigations/{id}/searches", { params: { path: { id: investigationId }, query: { limit } } }))) as unknown as SearchRun[],
  recordSearch: async (body: { investigationId: string; engine: SearchRun["engine"]; query: string; url: string; pageTitle: string; results: SerpResult[] }) =>
    (await unwrap(client.POST("/api/searches", { body }))) as unknown as SearchRun & { duplicate?: boolean },

  visits: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/visits", id(investigationId)))) as unknown as PageVisit[],
  recordVisit: async (body: { investigationId: string; url: string; title: string; referrer: string; found: { engine: string; query: string } | null; meta: Record<string, unknown> }) =>
    (await unwrap(client.POST("/api/visits", { body }))) as unknown as PageVisit,

  savedSearches: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/saved-searches", id(investigationId)))) as unknown as SavedSearch[],
  saveSearch: async (body: { investigationId: string; kind: "web" | "lab"; query: string; engines: string[] }) =>
    (await unwrap(client.POST("/api/saved-searches", { body }))) as unknown as SavedSearch,
  markRerun: async (savedId: string) => (await unwrap(client.POST("/api/saved-searches/{id}/run", id(savedId)))) as unknown as SavedSearch,
  deleteSavedSearch: (savedId: string) => unwrap(client.DELETE("/api/saved-searches/{id}", id(savedId))),

  archiveStatus: () => unwrap(client.GET("/api/archive/status")),
  /** Wayback history of a URL; with a case, looked up through that case's route. */
  archiveLookup: async (url: string, refresh = false, investigationId?: string) =>
    (await unwrap(client.POST("/api/archive/lookup", { body: { url, refresh, ...(investigationId ? { investigationId } : {}) } }))) as unknown as ArchiveHistory,
  archiveSave: async (investigationId: string, url: string, intakeId = "") =>
    (await unwrap(client.POST("/api/archive/save", { body: { investigationId, url, intakeId } }))) as unknown as ArchiveJob,
  archive: async (investigationId: string) =>
    (await unwrap(client.GET("/api/investigations/{id}/archive", id(investigationId)))) as unknown as { jobs: ArchiveJob[]; histories: ArchiveHistory[] },

  // hvnt33's own archive: snapshots, watches and detected changes.
  snapshot: async (investigationId: string, url: string, intakeId?: string) =>
    (await unwrap(client.POST("/api/snapshots", { body: { investigationId, url, ...(intakeId ? { intakeId } : {}) } }))) as unknown as ArchiveJob,
  snapshots: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/snapshots", id(investigationId)))) as unknown as OwnSnapshot[],
  replayUrl: (snapshotId: string) => unwrap(client.GET("/api/snapshots/{id}/replay-url", id(snapshotId))),
  watches: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/watches", id(investigationId)))) as unknown as Watch[],
  watch: async (investigationId: string, url: string, everyHours: number) =>
    (await unwrap(client.POST("/api/watches", { body: { investigationId, url, everyHours } }))) as unknown as Watch,
  updateWatch: async (watchId: string, body: { active?: boolean; everyHours?: number }) =>
    (await unwrap(client.PATCH("/api/watches/{id}", { ...id(watchId), body }))) as unknown as Watch,
  runWatch: async (watchId: string) => (await unwrap(client.POST("/api/watches/{id}/run", id(watchId)))) as unknown as Watch,
  unwatch: (watchId: string) => unwrap(client.DELETE("/api/watches/{id}", id(watchId))),
  changes: async (investigationId: string) => (await unwrap(client.GET("/api/investigations/{id}/page-changes", id(investigationId)))) as unknown as PageChange[],
  changeDiff: (changeId: string) => unwrap(client.GET("/api/page-changes/{id}/diff", id(changeId))),
  markChangeSeen: async (changeId: string, seen = true) =>
    (await unwrap(client.PATCH("/api/page-changes/{id}", { ...id(changeId), body: { seen } }))) as unknown as PageChange,
  /** Save a snapshot's evidence package to ~/Downloads (natively; returns the saved path). */
  downloadEvidence: (s: OwnSnapshot) => {
    const host = (() => { try { return new URL(s.url).hostname; } catch { return "page"; } })();
    return invoke<string>("api_download", { path: `/api/snapshots/${s.id}/evidence`, fileName: `hvnt33 evidence ${host} ${s.capturedAt.slice(0, 19).replace(/:/g, "-")}.zip` });
  },
};
