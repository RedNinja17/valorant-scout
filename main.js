const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');

let main;
let auto = null;

function getLockfile() {
    const filePath = path.join(
        process.env.LOCALAPPDATA,
        'Riot Games\\Riot Client\\Config\\lockfile'
    );

    if (!fs.existsSync(filePath)) {
        throw new Error('Valorant is not running.');
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const [name, pid, port, password, protocol] = content.split(':');
    const auth = Buffer.from(`riot:${password}`).toString('base64');

    return { port, auth };
}

async function getPlayers() {
    const { port, auth } = getLockfile();
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get(`https://127.0.0.1:${port}/chat/v4/presences`, {
        headers: { Authorization: `Basic ${auth}` },
        httpsAgent: agent
    });

    const presences = response.data.presences || [];

    return presences.filter(p => p.game_name && p.game_tag).map(p => {
        let teamId = 'Unknown';

        if (p.private) {
            try {
                const decoded = Buffer.from(p.private, 'base64').toString('utf-8');
                const data = JSON.parse(decoded);
                if (data.partyOwnerMatchMap) {
                    teamId = data.customGameTeam || data.partyState || 'Lobby';
                }
            } catch (e) {

            }
        }
        return {
            name: p.game_name,
            tag: p.game_tag,
            team: teamId,
            url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(p.game_name)}%23${encodeURIComponent(p.game_tag)}/overview`
        };
    });
}

function createWindow() {
    main = new BrowserWindow({
        width: 1440,
        height: 1280,
        title: "Valorant Scout",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true
        }
    });

    main.loadFile(path.join(__dirname, 'index.html'));

    auto = setInterval(async () => {
        try {
            const players = await getPlayers();
            if (main && !main.isDestroyed()) {
                main.webContents.send('lobby-updated', players);
            }
        } catch (err) {

        }
    }, 10000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (auto) clearInterval(auto);
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('fetch-players', async () => {
    try {
        return await getPlayers();
    } catch (err) {
        return { error: err.message };
    }
});