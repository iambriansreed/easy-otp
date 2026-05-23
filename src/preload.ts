import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    saveAccounts: (accounts: unknown) => ipcRenderer.invoke('save-accounts', accounts),
    openNotificationSettings: () => ipcRenderer.invoke('open-notification-settings'),
});
