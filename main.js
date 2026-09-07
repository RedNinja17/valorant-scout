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
        'Riot Games\\RiotClient\\Config\\lockfile'
    );

    if (!fs.existsSync(filePath)) {
        throw new Error('Valorant is not running.');
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const [name, pid, port, password, protocol] = content.split(':');
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
    const sessions = await fetchLocal('/product-session/v1/external-sessions');
    let region = 'na';

    const session = Object.values(sessions).find(s => s.productId === 'valorant');
    if (session && session.launchArguments) {
        const arg = session.launchArguments.find(a => a.startsWith('-ares-deployment='));
        if (arg) region = arg.split('=')[1];
    }

    return {
        accessToken: data.accessToken,
        entitlementsToken: data.token,
        puuid: data.subject,
        region: region
    };
}

async function getPlayers() {
    try {
        const { accessToken, entitlementsToken, puuid, region } = await getAuthTokens();
        
        const remoteHeaders = {
            'Authorization': `Bearer ${accessToken}`,
            'X-Riot-Entitlements-JWT': entitlementsToken,
            'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
        };

        const glzUrl = `https://glz-${region}-1.${region}.a.pvp.net`;
        const pdUrl = `https://pd.${region}.a.pvp.net`;

        const selfNameRes = await axios.put(`${pdUrl}/name-service/v2/players`, [puuid], { headers: remoteHeaders });
        const selfInfo = selfNameRes.data[0];
        const selfPlayer = {
            name: `${selfInfo.GameName} (You)`,
            tag: selfInfo.TagLine,
            team: 'Blue',
            url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(selfInfo.GameName)}%23${encodeURIComponent(selfInfo.TagLine)}/overview`
        };

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
                return [selfPlayer];
            }
        }

        const endpoint = isPregame ? `${glzUrl}/pregame/v1/matches/${matchId}` : `${glzUrl}/core-game/v1/matches/${matchId}`;
        const matchData = await axios.get(endpoint, { headers: remoteHeaders });

        let playersData = [];
        const teamMap = {};

        if (isPregame) {
            const myTeam = matchData.data.Teams.find(t => t.Players.some(p => p.Subject === puuid));
            if (myTeam) {
                playersData = myTeam.Players;
                playersData.forEach(p => teamMap[p.Subject] = 'Blue');
            }
        } else {
            playersData = matchData.data.Players || [];
            playersData.forEach(p => teamMap[p.Subject] = p.TeamID);
        }

        const puuids = playersData.map(p => p.Subject);
        if (puuids.length === 0) return [selfPlayer];

        const namesResponse = await axios.put(`${pdUrl}/name-service/v2/players`, puuids, { headers: remoteHeaders });

        const matchPlayers = namesResponse.data.map(p => {
            const name = p.GameName;
            const tag = p.TagLine;
            return {
                name: name,
                tag: tag,
                team: teamMap[p.Subject] || 'Unknown',
                url: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}%23${encodeURIComponent(tag)}/overview`
            };
        });

        const otherPlayers = matchPlayers.filter(p => `${p.name}#${p.tag}` !== `${selfInfo.GameName}#${selfInfo.TagLine}`);
        return [selfPlayer, ...otherPlayers];

    } catch (err) {
        return [];
    }
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