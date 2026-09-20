import { app, net } from "electron";
import { command, emit } from "./ipc.ts";
import { isNewerVersion, newestPublicRelease, type PublicRelease } from "./update-policy.ts";

export type UpdateState = {
  status: "idle" | "checking" | "current" | "available" | "error";
  currentVersion: string;
  release: PublicRelease | null;
  message: string;
};

const API = "https://api.github.com/repos/kai-ten/hvnt33/releases?per_page=10";
let state: UpdateState = { status: "idle", currentVersion: app.getVersion(), release: null, message: "" };
let active: Promise<UpdateState> | null = null;

function publish(next: UpdateState) {
  state = next;
  emit("update:state", state);
  return state;
}

async function check(manual: boolean): Promise<UpdateState> {
  if (active) return active;
  active = (async () => {
    publish({ ...state, status: "checking", message: "" });
    try {
      const response = await net.fetch(API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": `HVNT33/${state.currentVersion}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const release = newestPublicRelease(await response.json());
      if (!release) throw new Error("No published HVNT33 release was found");
      return publish({
        status: isNewerVersion(state.currentVersion, release.version) ? "available" : "current",
        currentVersion: state.currentVersion,
        release,
        message: "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Automatic checks stay quiet when offline. Manual checks explain what happened.
      return publish(manual
        ? { ...state, status: "error", message: `Could not check for updates: ${message}` }
        : { ...state, status: "idle", message: "" });
    } finally {
      active = null;
    }
  })();
  return active;
}

command("update_get", () => state);
command("update_check", () => check(true));

export function initUpdates() {
  if (!app.isPackaged || process.env.HVNT33_E2E === "1") return;
  const timer = setTimeout(() => { void check(false); }, 12_000);
  timer.unref();
}
