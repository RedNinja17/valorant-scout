const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    fetchPlayers: () => ipcRenderer.invoke('fetch-players'),
    onLobbyUpdated: (callback) => {
        ipcRenderer.on('lobby-updated', (_event, value) => callback(value));
    }
});