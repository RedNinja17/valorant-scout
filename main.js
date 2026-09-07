const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');

let main;
let auto = null;

function getLockFile() {
    const path = path.join(
        process.env.LOCALAPPDATA,
        'Riot Games\Riot Client\Config\lockfile'
    );

    if (!fs.existsSync(path)) {
        throw new Error('Valorant is not running.');
    }

    const content = fs.readFileSync(path, 'utf8');
    const [name, pid, port, password, protocol] = content.split(':');
    const auth = Buffer.from('riot:${password}').toString('base64');

    return { port, auth };
}

async function getPlayers() {
    const { port, auth } = getLockFile;
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get('https:///127.0.0.1:${port}/chat/v4/presences', {
        headers: { Authorization: 'Basic ${auth}' },
        httpsAgent: agent
    });

    const presences = response.data.presences || [];

    return presences.filter(p => p.game_name && p.game_tag).map(p => {
        let teamId = 'Unknown';

        if (p.private) {
            try {
                const decoded = Buffer.from(p.private, 'base64').toString('utf-8');
                const data = JSON.parse(decoded);
                if(privateData.partyOwnerMatchMap) {
                    teamId = privateData.customGeamTeam || privateData.partyState || 'Lobby';
                }
            }
        }
    }
}