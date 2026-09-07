const { app, BrowserWindow, ipcMain, session: electronSession, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const axios = require('axios');

let main = null;
let autoTimeout = null;
let isPolling = false;
let mapNameCache = {};

async function fetchMapNames() {
    try {
        const res = await axios.get('https://valorant-api.com/v1/maps');
        if (res.data && res.data.data) {
            const cache = {};
            res.data.data.forEach(map => {
                if (map.mapUrl) {
                    const codeName = map.mapUrl.split('/').pop().toLowerCase();
                    cache[codeName] = map.displayName;
                }
            });
            mapNameCache = cache;
        }
    } catch (e) {
        console.warn('Failed to fetch dynamic map names:', e.message);
    }
}

function resolveMapName(rawMapPath) {
    if (!rawMapPath) return 'Unknown Map';
    const codeName = rawMapPath.split('/').pop().toLowerCase();

    if (mapNameCache[codeName]) {
        return mapNameCache[codeName];
    }

    return codeName.charAt(0).toUpperCase() + codeName.slice(1);
}

async function getMatchesDir() {
    const dir = path.join(app.getPath('userData'), 'matches');
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        console.error('Failed to create matches directory:', err);
    }
    return dir;
}

async function saveMatchToFile(matchData) {
    try {
        if (!matchData.matchId || matchData.matchId === 'menu') return;

        const safeMatchId = path.basename(matchData.matchId);
        const dir = await getMatchesDir();
        const filePath = path.join(dir, `${safeMatchId}.json`);

        await fs.writeFile(filePath, JSON.stringify(matchData, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving match file:', e);
    }
}

async function loadAllSavedMatches() {
    try {
        const dir = getMatchesDir();
        const files = await fs.readdir(dir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        const matches = [];

        for (const file of jsonFiles) {
            try {
                const filePath = path.join(dir, file);
                const content = await fs.readFile(filePath, 'utf8');
                matches.push(JSON.parse(content));
            } catch (fileErr) {
                console.error(`Error reading match file ${file}:`, fileErr);
            }
        }

        return matches;
    } catch (e) {
        console.error('Error loading saved matches:', e);
        return [];
    }
}

async function deleteMatchFile(matchId) {
    try {
        if (!matchId) return false;
        const safeMatchId = path.basename(matchId);
        const dir = getMatchesDir();
        const filePath = path.join(dir, `${safeMatchId}.json`);

        await fs.unlink(filePath);
        return true;
    } catch (e) {
        console.error('Error deleting match file:', e);
        return false;
    }
}

function getLockfile() {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const filePath = path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile');

    if (!fsSync.existsSync(filePath)) {
        throw new Error(`Lockfile not found at ${filePath}.`);
    }

    let content = '';
    try {
        content = fsSync.readFileSync(filePath, 'utf8');
    } catch (e) {
        throw new Error('Lockfile is locked.');
    }

    const parts = content.split(':');
    if (parts.length < 4) {
        throw new Error('Lockfile format is invalid.');
    }

    const port = parts[2];
    const password = parts[3];
    const auth = Buffer.from(`riot:${password}`).toString('base64');

    return { port, auth };
}

async function fetchLocal(urlPath) {
    const { port, auth } = getLockfile();
    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.get(`https://127.0.0.1:${port}${urlPath}`, {
        headers: { Authorization: `Basic ${auth}` },
        httpsAgent: agent
    });
    return response.data;
}

async function getAuthTokens() {
    const data = await fetchLocal('/entitlements/v1/token');
    let region = 'na';

    try {
        const externalSessions = await fetchLocal('/product-session/v1/external-sessions');
        const valSession = Object.values(externalSessions || {}).find(s => s?.productId === 'valorant');
        if (valSession?.launchArguments) {
            const arg = valSession.launchArguments.find(a => a?.startsWith('-ares-deployment='));
            if (arg) region = arg.split('=')[1];
        }
    } catch (e) {
        console.warn('Failed to fetch external product sessions, defaulting region to NA:', e.message);
    }

    if (region === 'latam' || region === 'br') region = 'na';

    let clientVersion = '';
    try {
        const versionRes = await axios.get('https://valorant-api.com/v1/version');
        clientVersion = versionRes.data.data.riotClientVersion;
    } catch (e) {
        console.warn('Failed to fetch client version:', e.message);
    }

    return {
        accessToken: data.accessToken,
        entitlementsToken: data.token,
        puuid: data.subject,
        region: region,
        clientVersion: clientVersion
    };
}

async function getPlayers() {
    try {
        const { accessToken, entitlementsToken, puuid, region, clientVersion } = await getAuthTokens();

        const remoteHeaders = {
            'Authorization': `Bearer ${accessToken}`,
            'X-Riot-Entitlements-JWT': entitlementsToken,
            'X-Riot-ClientVersion': clientVersion,
            'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
        };

        const glzUrl = `https://glz-${region}-1.${region}.a.pvp.net`;
        const pdUrl = `https://pd.${region}.a.pvp.net`;

        let selfInfo = { GameName: '', TagLine: '' };

        try {
            const selfNameRes = await axios.put(`${pdUrl}/name-service/v2/players`, [puuid], { headers: remoteHeaders });
            if (selfNameRes.data && selfNameRes.data[0]) {
                selfInfo = selfNameRes.data[0];
            }
        } catch (e) {
            console.warn('Failed to resolve self player name:', e.message);
        }

        let matchId = null;
        let isPregame = false;

        try {
            const coreGameRes = await axios.get(`${glzUrl}/core-game/v1/players/${puuid}`, { headers: remoteHeaders });
            matchId = coreGameRes.data.MatchID;
        } catch (e) {
            try {
                const pregameRes = await axios.get(`${glzUrl}/pregame/v1/players/${puuid}`, { headers: remoteHeaders });
                matchId = pregameRes.data.MatchID;
                isPregame = true;
            } catch (err) {
                return {
                    matchId: 'menu',
                    mapName: 'Main Menu',
                    timestamp: Date.now(),
                    players: [{
                        name: selfInfo.GameName ? `${selfInfo.GameName} (You)` : 'You',
                        tag: selfInfo.TagLine || '',
                        team: 'Blue',
                        isMyTeam: true,
                        puuid: puuid,
                        url: selfInfo.GameName ? `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(selfInfo.GameName)}%23${encodeURIComponent(selfInfo.TagLine)}/overview` : '#'
                    }]
                };
            }
        }

        const endpoint = isPregame ? `${glzUrl}/pregame/v1/matches/${matchId}` : `${glzUrl}/core-game/v1/matches/${matchId}`;
        const matchData = await axios.get(endpoint, { headers: remoteHeaders });

        let playersData = [];
        const rawTeamMap = {};
        let myRawTeam = 'Blue';

        if (isPregame) {
            const myTeamObj = matchData.data?.Teams?.find(t => t.Players?.some(p => p.Subject === puuid));
            if (myTeamObj?.Players) {
                playersData = myTeamObj.Players;
                const myTeamId = myTeamObj.TeamID || 'Blue';
                playersData.forEach(p => rawTeamMap[p.Subject] = myTeamId);
                myRawTeam = myTeamId;
            }
        } else {
            playersData = matchData.data?.Players || [];
            playersData.forEach(p => {
                rawTeamMap[p.Subject] = p.TeamID;
                if (p.Subject === puuid) {
                    myRawTeam = p.TeamID;
                }
            });
        }

        const puuids = playersData.map(p => p.Subject);
        if (puuids.length === 0) return { matchId: null, mapName: 'Unknown', timestamp: Date.now(), players: [] };

        const namesResponse = await axios.put(`${pdUrl}/name-service/v2/players`, puuids, { headers: remoteHeaders });
        const validPlayers = (namesResponse.data || []).filter(p => p.GameName && p.TagLine);

        const matchPlayers = validPlayers.map(p => {
            const name = p.GameName;
            const tag = p.TagLine;
            const isSelf = p.Subject === puuid;
            const actualTeam = rawTeamMap[p.Subject] || 'Unknown';

            return {
                name: isSelf ? `${name} (You)` : name,
                tag: tag,
                team: actualTeam,
                isMyTeam: actualTeam === myRawTeam,
                puuid: p.Subject,
                url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}%23${encodeURIComponent(tag)}/overview`
            };
        });

        const teammates = matchPlayers.filter(p => p.isMyTeam);
        const opponents = matchPlayers.filter(p => !p.isMyTeam);
        const sortedPlayers = [...teammates, ...opponents];

        const payload = {
            matchId: matchId,
            mapName: resolveMapName(matchData.data?.MapID),
            timestamp: Date.now(),
            players: sortedPlayers
        };

        await saveMatchToFile(payload);
        return payload;

    } catch (err) {
        console.error('Error in getPlayers:', err.message);
        return { matchId: null, mapName: 'Error', timestamp: Date.now(), players: [] };
    }
}

function setupAdBlocker() {
    const adDomains = [
        '*://*.doubleclick.net/*',
        '*://*.google-analytics.com/*',
        '*://*.googlesyndication.com/*',
        '*://*.adnxs.com/*',
        '*://*.amazon-adsystem.com/*',
        '*://*.pubmatic.com/*',
        '*://*.criteo.com/*',
        '*://*.taboola.com/*'
    ];

    electronSession.defaultSession.webRequest.onBeforeRequest({ urls: adDomains }, (details, callback) => {
        callback({ cancel: true });
    });
}

let lastMatchSignature = '';

async function pollLobby() {
    if (isPolling) return;
    isPolling = true;

    try {
        const data = await getPlayers();
        if (data && data.players) {
            const playerIdsSorted = data.players.map(p => p.puuid).slice().sort().join(',');
            const currentSignature = `${data.matchId}:${playerIdsSorted}`;

            if (currentSignature !== lastMatchSignature) {
                lastMatchSignature = currentSignature;
                if (main && !main.isDestroyed()) {
                    main.webContents.send('lobby-updated', data);
                }
            }
        }
    } catch (err) {
        console.error('Error during lobby polling:', err.message);
    } finally {
        isPolling = false;
        if (main && !main.isDestroyed()) {
            stopPolling();
            autoTimeout = setTimeout(pollLobby, 8000);
        }
    }
}

function stopPolling() {
    if (autoTimeout) {
        clearTimeout(autoTimeout);
        autoTimeout = null;
    }
}

async function createWindow() {
    setupAdBlocker();
    await fetchMapNames();

    main = new BrowserWindow({
        width: 1440,
        height: 1280,
        title: "Valorant Scout",
        frame: true,
        backgroundColor: '#0f1923',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true
        }
    });

    main.loadFile(path.join(__dirname, 'index.html'));

    globalShortcut.register('Alt+Shift+V', () => {
        if (!main) return;
        if (main.isVisible()) {
            main.hide();
        } else {
            main.show();
            main.focus();
        }
    });

    stopPolling();
    pollLobby();

    main.on('closed', () => {
        stopPolling();
        main = null;
    });
}

app.whenReady().then(createWindow);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    stopPolling();
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('fetch-players', async () => {
    try {
        const data = await getPlayers();
        return { success: true, data: data };
    } catch (err) {
        return { success: false, error: err.message || 'Error fetching players' };
    }
});

ipcMain.handle('load-saved-matches', async () => {
    return await loadAllSavedMatches();
});

ipcMain.handle('delete-match', async (_event, matchId) => {
    return await deleteMatchFile(matchId);
});