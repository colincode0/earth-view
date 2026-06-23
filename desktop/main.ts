import path from "node:path";
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { readConfig } from "./config";
import { startServer } from "./server";

let serverPort = 0;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

function resolvePaths() {
  // In a packaged app the frontend lives in extraResources; in dev it's the
  // root project's `dist/` (this file runs from `desktop/build/main.cjs`).
  const frontendDir = app.isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.join(__dirname, "..", "..", "dist");
  const settingsHtmlPath = path.join(__dirname, "settings.html");
  const configPath = path.join(app.getPath("userData"), "config.json");
  return { frontendDir, settingsHtmlPath, configPath };
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Earth View",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Open external links (e.g. Google Maps handoff) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 660,
    resizable: true,
    title: "Earth View — Settings",
    parent: mainWindow ?? undefined,
    backgroundColor: "#0b0f17",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  // Open the blurb's YouTube / mailto links in the user's browser & mail client
  // rather than navigating the settings window.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") || url.startsWith("mailto:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  settingsWindow.loadURL(`http://127.0.0.1:${serverPort}/settings.html`);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Earth View",
      submenu: [
        { label: "Settings (API keys)…", accelerator: "CmdOrCtrl+,", click: openSettings },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// A single instance is plenty; focus the existing window if relaunched.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const paths = resolvePaths();
    serverPort = await startServer(paths);
    buildMenu();
    await createMainWindow();

    // First-run helper: if Sentinel (Copernicus) credentials aren't set up yet,
    // open the settings page so the user can paste their keys.
    const config = readConfig(paths.configPath);
    const hasSentinelCreds = Boolean(
      config.COPERNICUS_CLIENT_ID && config.COPERNICUS_CLIENT_SECRET,
    );
    if (!hasSentinelCreds) {
      openSettings();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
