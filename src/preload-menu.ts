import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('menu', {
    items: () => ipcRenderer.invoke('menu:items'),
    /** Report the laid-out size; main positions and reveals the window. */
    ready: (size: { width: number; height: number }) => ipcRenderer.send('menu:ready', size),
    invoke: (id: string) => ipcRenderer.send('menu:invoke', id),
    close: () => ipcRenderer.send('menu:close'),
    // main sends the payload directly on every refresh after the first, so the
    // renderer doesn't have to invoke 'menu:items' again just to re-fetch what
    // main already computed to build this event.
    onRefresh: (fn: (payload?: { rows: unknown[]; accent: string }) => void) =>
        ipcRenderer.on('menu:refresh', (_event, payload) => fn(payload)),
    onCopied: (fn: (payload: { issuer: string; code: string }) => void) =>
        ipcRenderer.on('menu:copied', (_event, payload) => fn(payload)),
});
