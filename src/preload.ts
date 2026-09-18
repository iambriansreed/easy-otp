import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    saveAccounts: (accounts: unknown) => ipcRenderer.invoke('save-accounts', accounts),
    fetchFavicon: (issuer: string) => ipcRenderer.invoke('fetch-favicon', issuer),
    guessFaviconDomain: (issuer: string) => ipcRenderer.invoke('guess-favicon-domain', issuer),
    showEmojiPanel: () => ipcRenderer.invoke('show-emoji-panel'),
    onAccountIconFound: (fn: (found: unknown) => void) =>
        ipcRenderer.on('account-icon-found', (_event, found) => fn(found)),
});
