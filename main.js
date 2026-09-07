const { app, BrowserWindow, ipcMain, session: electronSession, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const axios = require('axios');

let main = null;
let autoTimeout = null;
let isPolling = false;
let mapNameCache = {};
let tierNameCache = {};
let matchesDir = null;
const mmrCache = new Map();
const localHttpsAgent = new https.Agent({ rejectUnauthorized: false });

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
        console.warn('Failed to fetch map names:', e.message);
    }
}

async function fetchCompetitiveTiers() {
    try {
        const res = await axios.get('https://valorant-api.com/v1/competitivetiers');
        const episodes = res.data?.data || [];
        const latest = episodes[episodes.length - 1];
        const cache = {};
        (latest?.tiers || []).forEach(t => {
            cache[t.tier] = t.tierName;
        });
        tierNameCache = cache;
    } catch (e) {
        console.warn('Failed to fetch competitive tiers:', e.message);
    }
}

function resolveMapName(rawMapName) {
    if (!rawMapName) return 'Unknown Map';
    const codeName = rawMapName.split('/').pop().toLowerCase();
    return mapNameCache[codeName] || (codeName.charAt(0).toUpperCase() + codeName.slice(1));
}

function tierNameFor(tier) {
    const raw = tierNameCache[tier];
    if (!raw) return 'Unranked';
    return raw.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function getMatchesDir() {
    if (matchesDir) return matchesDir;
    const dir = path.join(app.getPath('userData'), 'matches');
    try {
        await fs.mkdir(dir, { recursive: true });
        matchesDir = dir;
    } catch (err) {
        console.error('Failed to create matches folder:', err);
    }
    return dir;
}

async function saveMatches(matchData) {
    try {
        if (!matchData.matchId || matchData.matchId === 'menu') return;
        const safeMatchId = path.basename(matchData.matchId);
        const dir = await getMatchesDir();
        const filePath = path.join(dir, `${safeMatchId}.json`);
        await fs.writeFile(filePath, JSON.stringify(matchData, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving match:', e);
    }
}

async function loadMatches() {
    try {
        const dir = await getMatchesDir();
        const files = await fs.readdir(dir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const matchPromises = jsonFiles.map(async (file) => {
            try {
                const filePath = path.join(dir, file);
                const content = await fs.readFile(filePath, 'utf8');
                return JSON.parse(content);
            } catch (fileErr) {
                console.error(`Error reading match file ${file}:`, fileErr);
                return null;
            }
        });

        const matches = await Promise.all(matchPromises);
        return matches.filter(Boolean);
    } catch (e) {
        console.error('Error loading saved matches:', e);
        return [];
    }
}

async function deleteSave(matchID) {
    try {
        if (!matchID) return false;
        const safeMatchId = path.basename(matchID);
        const dir = await getMatchesDir();
        const filePath = path.join(dir, `${safeMatchId}.json`);
        await fs.unlink(filePath);
        return true;
    } catch (e) {
        console.error('Error deleting match file:', e);
        return false;
    }
}

async function getLockfile() {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const filePath = path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile');

    try {
        await fs.access(filePath);
    } catch {
        throw new Error(`Lockfile not found at ${filePath}.`);
    }

    const content = await fs.readFile(filePath, 'utf8');
    const parts = content.split(':');
    if (parts.length < 4) throw new Error('Lockfile format is invalid.');

    const port = parts[2];
    const password = parts[3];
    const auth = Buffer.from(`riot:${password}`).toString('base64');

    return { port, auth };
}

async function fetchLocal(urlPath) {
    const { port, auth } = await getLockfile();
    const response = await axios.get(`https://127.0.0.1:${port}${urlPath}`, {
        headers: { Authorization: `Basic ${auth}` },
        httpsAgent: localHttpsAgent
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
        console.warn('Failed to fetch region, defaulting to NA:', e.message);
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

async function fetchRank(puuid, pdUrl, remoteHeaders) {
    if (mmrCache.has(puuid)) return mmrCache.get(puuid);

    try {
        const res = await axios.get(`${pdUrl}/mmr/v1/players/${puuid}`, { headers: remoteHeaders });
        const latest = res.data?.LatestCompetitiveUpdate;
        const tier = latest?.TierAfterUpdate ?? 0;

        const rank = {
            tier: tier,
            tierName: tierNameFor(tier),
            rr: tier > 0 ? (latest?.RankedRatingAfterUpdate ?? null) : null
        };

        mmrCache.set(puuid, rank);
        return rank;
    } catch (e) {
        console.warn(`Failed to fetch MMR for ${puuid}:`, e.message);
        return null;
    }
}

function enrichWithRanks(payload, pdUrl, remoteHeaders) {
    Promise.all(payload.players.map(p => fetchRank(p.puuid, pdUrl, remoteHeaders)))
        .then(async (ranks) => {
            payload.players.forEach((p, i) => {
                p.rank = ranks[i];
            });
            await saveMatches(payload);
            if (main && !main.isDestroyed()) {
                main.webContents.send('lobby-updated', payload);
            }
        })
        .catch(err => console.warn('Rank enrichment failed:', err.message));
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
                        name: selfInfo.GameName || 'You',
                        tag: selfInfo.TagLine || '',
                        team: 'Blue',
                        isMyTeam: true,
                        isSelf: true,
                        puuid: puuid,
                        agentId: null,
                        accountLevel: null,
                        incognito: false,
                        rank: mmrCache.get(puuid) || null,
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
                if (p.Subject === puuid) myRawTeam = p.TeamID;
            });
        }

        const identityMap = {};
        playersData.forEach(p => {
            identityMap[p.Subject] = {
                agentId: p.CharacterID || null,
                accountLevel: p.PlayerIdentity?.AccountLevel ?? null,
                incognito: p.PlayerIdentity?.Incognito ?? false
            };
        });

        const puuids = playersData.map(p => p.Subject);
        if (puuids.length === 0) return { matchId: null, mapName: 'Unknown', timestamp: Date.now(), players: [] };

        const namesResponse = await axios.put(`${pdUrl}/name-service/v2/players`, puuids, { headers: remoteHeaders });
        const validPlayers = (namesResponse.data || []).filter(p => p.GameName && p.TagLine);

        const matchPlayers = validPlayers.map(p => {
            const name = p.GameName;
            const tag = p.TagLine;
            const isSelf = p.Subject === puuid;
            const actualTeam = rawTeamMap[p.Subject] || 'Unknown';
            const identity = identityMap[p.Subject] || {};

            return {
                name: name,
                tag: tag,
                team: actualTeam,
                isMyTeam: actualTeam === myRawTeam,
                isSelf: isSelf,
                puuid: p.Subject,
                agentId: identity.agentId || null,
                accountLevel: identity.accountLevel ?? null,
                incognito: identity.incognito ?? false,
                rank: mmrCache.get(p.Subject) || null,
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

        await saveMatches(payload);
        enrichWithRanks(payload, pdUrl, remoteHeaders);

        return payload;

    } catch (err) {
        console.error('Error in getPlayers():', err.message);
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
        '*://*.taboola.com/*',
        '*://*.compasonline.com/*',
        '*://*.nitropay.com/*'
    ];

    const configureSession = (sess) => {
        sess.webRequest.onBeforeRequest({ urls: adDomains }, (details, callback) => {
            callback({ cancel: true });
        });

        sess.webRequest.onBeforeSendHeaders(
            { urls: ['*://*.tracker.gg/*'] },
            (details, callback) => {
                details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
                details.requestHeaders['Referer'] = 'https://tracker.gg/';
                details.requestHeaders['Origin'] = 'https://tracker.gg';
                delete details.requestHeaders['X-Requested-With'];
                callback({ requestHeaders: details.requestHeaders });
            }
        );
    };

    configureSession(electronSession.defaultSession);
    configureSession(electronSession.fromPartition('persist:tracker'));
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
    await Promise.all([fetchMapNames(), fetchCompetitiveTiers()]);

    main = new BrowserWindow({
        width: 1440,
        height: 1280,
        title: "Valorant Scout",
        frame: false, // Disables default native window border/title bar
        backgroundColor: '#0f1923',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            webSecurity: true
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

app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('silent-debugger-extension-api');
app.whenReady().then(createWindow);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
    stopPolling();
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('close-app', () => {
    if (main && !main.isDestroyed()) {
        main.close();
    }
});

ipcMain.handle('fetch-players', async () => {
    try {
        const data = await getPlayers();
        return { success: true, data: data };
    } catch (err) {
        return { success: false, error: err.message || 'Error fetching players' };
    }
});

ipcMain.handle('load-saved-matches', async () => await loadMatches());

ipcMain.handle('delete-match', async (_event, matchId) => await deleteSave(matchId));

ipcMain.handle('fetch-tracker-match', async (_event, matchId) => {
    try {
        const res = await axios.get(`https://api.tracker.gg/api/v2/valorant/standard/matches/${matchId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://tracker.gg/',
                'Origin': 'https://tracker.gg'
            }
        });
        return { success: true, data: res.data };
    } catch (err) {
        return { success: false, error: err.message };
    }
});