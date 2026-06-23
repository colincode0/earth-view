import { contextBridge } from "electron";

// Marker exposed to the renderer (the web frontend) so it can detect that it is
// running inside the desktop (Electron) build and show desktop-specific copy.
contextBridge.exposeInMainWorld("earthViewDesktop", { isDesktop: true });
