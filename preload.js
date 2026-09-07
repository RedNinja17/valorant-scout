const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    fetchPlayers: () => ipcRenderer.invoke('fetch-players'),

    onLobbyUpdated: (callback) => {
        const subscription = (_event, value) => callback(value);
        ipcRenderer.on('lobby-updated', subscription);

        return () => {
            ipcRenderer.removeListener('lobby-updated', subscription);
        };
    }
});