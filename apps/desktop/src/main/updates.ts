import { app, net } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";
import { command, emit } from "./ipc.ts";
import { isNewerVersion, newestPublicRelease, type PublicRelease } from "./update-policy.ts";

const { autoUpdater } = electronUpdater;

export type UpdateState = {
  status: "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  release: PublicRelease | null;
  message: string;
  progress: number;
  installable: boolean;
};

const API = "https://api.github.com/repos/kai-ten/hvnt33/releases?per_page=10";
const RELEASE = "https://github.com/kai-ten/hvnt33/releases/tag/";
// electron-updater selects the packaged format at runtime: macOS ZIP, Windows
// NSIS, Linux AppImage, or Debian package (with the normal OS elevation prompt).
const installable = true;
let state: UpdateState = {
  status: "idle", currentVersion: app.getVersion(), release: null, message: "", progress: 0, installable,
};
let active: Promise<UpdateState> | null = null;
let manualCheck = false;
let prepareInstall: (() => Promise<void>) | null = null;

function publish(next: UpdateState) {
  state = next;
  emit("update:state", state);
  return state;
}

function releaseFrom(info: UpdateInfo): PublicRelease {
  return {
    version: info.version,
    name: typeof info.releaseName === "string" && info.releaseName.trim() ? info.releaseName : `HVNT33 v${info.version}`,
    url: `${RELEASE}v${encodeURIComponent(info.version)}`,
    publishedAt: info.releaseDate,
    prerelease: /-/.test(info.version),
  };
}

/** Development fallback: there is no packaged app-update.yml outside an installer. */
async function checkReleasePage(manual: boolean): Promise<UpdateState> {
  try {
    const response = await net.fetch(API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `HVNT33/${state.currentVersion}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = newestPublicRelease(await response.json());
    if (!release) throw new Error("No published HVNT33 release was found");
    return publish({
      ...state,
      status: isNewerVersion(state.currentVersion, release.version) ? "available" : "current",
      release,
      message: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return publish(manual
      ? { ...state, status: "error", message: `Could not check for updates: ${message}` }
      : { ...state, status: "idle", message: "" });
  }
}

async function check(manual: boolean): Promise<UpdateState> {
  if (active) return active;
  manualCheck = manual;
  active = (async () => {
    publish({ ...state, status: "checking", message: "", progress: 0 });
    try {
      if (!app.isPackaged) return await checkReleasePage(manual);
      await autoUpdater.checkForUpdates();
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return publish(manual
        ? { ...state, status: "error", message: `Could not check for updates: ${message}` }
        : { ...state, status: "idle", message: "" });
    } finally {
      active = null;
      manualCheck = false;
    }
  })();
  return active;
}

async function download(): Promise<UpdateState> {
  if (state.status !== "available" || !state.release) return state;
  if (!state.installable) {
    return publish({ ...state, message: "This installation is updated through your Linux package manager." });
  }
  publish({ ...state, status: "downloading", message: "", progress: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publish({ ...state, status: "error", message: `Could not download the update: ${message}` });
  }
  return state;
}

async function install(): Promise<void> {
  if (state.status !== "downloaded" || !prepareInstall) return;
  publish({ ...state, message: "Closing the investigation safely…" });
  await prepareInstall();
  autoUpdater.quitAndInstall(false, true);
}

command("update_get", () => state);
command("update_check", () => check(true));
command("update_download", () => download());
command("update_install", () => install());

export function initUpdates(beforeInstall: () => Promise<void>) {
  prepareInstall = beforeInstall;
  if (!app.isPackaged || process.env.HVNT33_E2E === "1") return;

  // Fetch the signed payload quietly so applying it is a single explicit click.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  // Separate metadata per CPU architecture prevents an Intel Mac from being
  // offered the Apple Silicon ZIP (and vice versa).
  autoUpdater.channel = `latest-${process.arch}`;
  // Assigning a custom channel enables downgrades in electron-updater; HVNT33
  // never needs that behavior and must not accept an older release.
  autoUpdater.allowDowngrade = false;
  autoUpdater.requestHeaders = { "User-Agent": `HVNT33/${state.currentVersion}` };

  autoUpdater.on("update-available", info => publish({
    ...state, status: "available", release: releaseFrom(info), message: "", progress: 0,
  }));
  autoUpdater.on("update-not-available", info => publish({
    ...state, status: "current", release: releaseFrom(info), message: "", progress: 0,
  }));
  autoUpdater.on("download-progress", progress => publish({
    ...state, status: "downloading", progress: Math.max(0, Math.min(100, progress.percent)), message: "",
  }));
  autoUpdater.on("update-downloaded", info => publish({
    ...state, status: "downloaded", release: releaseFrom(info), progress: 100, message: "",
  }));
  autoUpdater.on("error", error => {
    if (state.status === "downloading" || manualCheck) {
      publish({ ...state, status: "error", message: `Update failed: ${error.message}` });
    } else {
      publish({ ...state, status: "idle", message: "" });
    }
  });

  const timer = setTimeout(() => { void check(false); }, 12_000);
  timer.unref();
}
