// Menu entries double as shortcuts: they work even while a browsed page has
// keyboard focus, which in-page key handlers could not. Each sends its id to
// the app view as a `menu` event.
import { Menu, nativeTheme, type MenuItemConstructorOptions } from "electron";
import { emit } from "./ipc.ts";

const item = (id: string, label: string, accelerator?: string): MenuItemConstructorOptions => ({ id, label, accelerator, click: () => emit("menu", id) });
export type AppTheme = "system" | "lapis" | "nox";

export function setAppTheme(theme: AppTheme) {
  nativeTheme.themeSource = theme === "lapis" ? "light" : theme === "nox" ? "dark" : "system";
  for (const value of ["system", "lapis", "nox"] as const) {
    const menuItem = Menu.getApplicationMenu()?.getMenuItemById(`theme-${value}`);
    if (menuItem) menuItem.checked = value === theme;
  }
}

const themeItem = (theme: AppTheme, label: string): MenuItemConstructorOptions => ({
  id: `theme-${theme}`,
  label,
  type: "radio",
  checked: theme === "system",
  click: () => { setAppTheme(theme); emit("menu", `theme-${theme}`); },
});

export function buildMenu(): Menu {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: "HVNT33", submenu: [{ role: "about", label: "About HVNT33" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        item("search", "Search Engines…", "CmdOrCtrl+K"),
        item("new-tab", "New Tab", "CmdOrCtrl+T"),
        item("close-tab", "Close Tab", "CmdOrCtrl+W"),
        item("address", "Open Location…", "CmdOrCtrl+L"),
        { type: "separator" },
        item("connection", "Connect to Server…", "CmdOrCtrl+Shift+,"),
        { type: "separator" },
        item("clear-browsing-data", "Clear Browsing Data…"),
        ...(mac ? [] : [{ type: "separator" }, { role: "quit" }] as MenuItemConstructorOptions[]),
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "Capture",
      submenu: [
        item("capture-selection", "Capture Selection or Image", "CmdOrCtrl+Shift+S"),
        item("capture-page", "Capture Whole Page", "CmdOrCtrl+Shift+P"),
        item("record-results", "Record Search Results", "CmdOrCtrl+Shift+R"),
      ],
    },
    {
      label: "View",
      submenu: [
        item("view-browser", "Browser", "CmdOrCtrl+1"),
        item("view-lab", "Search Lab", "CmdOrCtrl+2"),
        item("view-case", "Case", "CmdOrCtrl+4"),
        item("data-panel", "Data Panel", "CmdOrCtrl+3"),
        item("toggle-terminal", "Focus Agent Terminal", "CmdOrCtrl+J"),
        { type: "separator" },
        item("back", "Back", "CmdOrCtrl+["),
        item("forward", "Forward", "CmdOrCtrl+]"),
        item("reload", "Reload Page", "CmdOrCtrl+R"),
        { type: "separator" },
        { label: "Appearance", submenu: [themeItem("system", "System"), themeItem("lapis", "Lapis — Light"), themeItem("nox", "Nox — Dark")] },
        { type: "separator" },
        { role: "resetZoom", label: "Actual Size" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
    { label: "Help", submenu: [item("check-updates", "Check for Updates…"), { type: "separator" }, item("website", "HVNT33 Website")] },
  ];
  return Menu.buildFromTemplate(template);
}
