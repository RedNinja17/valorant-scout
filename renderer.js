let activeMatchId = null;
let activePlayerId = null;
let userSelectedMatch = false;
const matchCache = new Map(); // matchid, matchobj

const MAX_LIVE_VIEWS = 5;
const view_order = [];

function viewIdFor(matchId, puuid) {
    return `webview-${matchId}-${puuid}`;
}

function touchView(viewId) {
    const i = view_order.indexOf(viewId);
    if (i !== -1) {
        view_order.splice(i, 1);
    }
    view_order.push(viewId);
}

function destroyView(viewId) {
    const el = document.getElementById(viewId);
    if (el) el.remove();
    const i = view_order.indexOf(viewId);
    if (i !== -1) {
        view_order.splice(i, 1);
    }
}

function evictStaleViews() {
    const container = document.getElementById('views-container');
    container.querySelectorAll('webview').forEach(v => {
        if(v.dataset.matchId !== activeMatchId) {
            destroyView(v.id);
        }
    });
    const keep = viewIdFor(activeMatchId, activePlayerId);
    while(view_order.length > MAX_LIVE_VIEWS) {
        const oldest = view_order.find(id => id !== keep);
        if(!oldest) break;
        destroyView(oldest);
    }
}

function showEmptyState(message) {
    const container = document.getElementById('views-container');
    container.querySelectorAll('webview').forEach(v => destroyView(v.id));

    let el = container.querySelector('.empty-state');
    if (!el) {
        el = document.createElement('div');
        el.className = 'empty-state';
        container.appendChild(el);
    }
    el.innerHTML = '';
    const p = document.createElement('p');
    p.innerText = message;
    el.appendChild(p);
}

function clearEmptyState() {
    const el = document.getElementById('views-container').querySelector('.empty-state');
    if (el) el.remove();
}

function formatDateHeader(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}

function renderApp() {
    renderMatchHistoryBar();
    renderPlayerTabsBar();
    syncWebviewVisibility();
}

function handleLobbyPayload(payload) {
    if (!payload || !payload.players || payload.players.length === 0) {
        document.getElementById('status-text').innerText = "No active match found.";
        document.getElementById('status-indicator').className = "offline";
        return;
    }

    const { matchId, mapName, players, timestamp } = payload;
    const key = matchId || 'current';

    const isNewMatch = !matchCache.has(key);
    if (!isNewMatch) {
        const existing = matchCache.get(key);
        existing.players = players;
        existing.mapName = mapName || existing.mapName;
    } else {
        matchCache.set(key, {
            matchId: key,
            mapName: mapName || 'Match',
            timestamp: timestamp || Date.now(),
            players: players
        });
    }

    if (isNewMatch) userSelectedMatch = false;
    if (!userSelectedMatch) activeMatchId = key;

    const active = matchCache.get(activeMatchId);
    if (active && (!activePlayerId || !active.players.some(p => p.puuid === activePlayerId))) {
        activePlayerId = active.players[0]?.puuid || null;
    }

    document.getElementById('status-indicator').className = "online";
    document.getElementById('status-text').innerText = `Active (${players.length} Players Found)`;

    renderApp();
}

function renderMatchHistoryBar() {
    const container = document.getElementById('match-tabs-list');
    container.innerHTML = '';

    const sortedMatches = Array.from(matchCache.values()).sort((a, b) => b.timestamp - a.timestamp);

    // Group by Day String
    const grouped = new Map();
    sortedMatches.forEach(match => {
        const dayLabel = formatDateHeader(match.timestamp);
        if (!grouped.has(dayLabel)) grouped.set(dayLabel, []);
        grouped.get(dayLabel).push(match);
    });

    grouped.forEach((matches, dayLabel) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'date-group';

        const labelEl = document.createElement('span');
        labelEl.className = 'date-label';
        labelEl.innerText = dayLabel;
        groupEl.appendChild(labelEl);

        matches.forEach(match => {
            const btn = document.createElement('button');
            btn.className = `match-tab-btn ${match.matchId === activeMatchId ? 'active' : ''}`;

            const timeStr = new Date(match.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            btn.innerHTML = `
                <span class="match-map">${match.mapName}</span>
                <span class="match-time">${timeStr}</span>
            `;
            btn.onclick = () => {
                userSelectedMatch = true;
                activeMatchId = match.matchId;
                activePlayerId = match.players[0]?.puuid || null;
                renderApp();
            };
            groupEl.appendChild(btn);
        });

        container.appendChild(groupEl);
    });
}

function renderPlayerTabsBar() {
    const tabsBar = document.getElementById('player-tabs-bar');
    tabsBar.innerHTML = '';

    const currentMatch = matchCache.get(activeMatchId);
    if (!currentMatch) return;

    const players = currentMatch.players;

    players.forEach((player, index) => {
        if (index > 0 && players[index - 1].isMyTeam !== player.isMyTeam) {
            const divider = document.createElement('div');
            divider.className = 'team-divider';
            tabsBar.appendChild(divider);
        }

        const btn = document.createElement('button');
        btn.className = `player-tab-btn ${player.puuid === activePlayerId ? 'active' : ''}`;

        const dot = document.createElement('span');
        dot.className = `team-dot ${player.isMyTeam ? 'team-blue' : 'team-red'}`;
        btn.appendChild(dot);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.innerText = player.name;
        btn.appendChild(nameSpan);

        btn.onclick = () => {
            activePlayerId = player.puuid;
            renderApp();
        };

        tabsBar.appendChild(btn);
    });
}

function syncWebviewVisibility() {
    const container = document.getElementById('views-container');
    const currentMatch = matchCache.get(activeMatchId);
    if(!currentMatch || !activePlayerId) {
        showEmptyState(matchCache.size === 0 ? "No matches saved." : "No active match.");
        return;
    }
    const player = currentMatch.players.find(p => p.puuid === activePlayerId);
    if(!player) {
        showEmptyState("Player not found in this match.")
        return;
    }
    clearEmptyState();

    const viewId = viewIdFor(activeMatchId, activePlayerId);
    let webview = document.getElementById(viewId);
    if(!webview) {
        webview = document.createElement('webview');
        webview.id = viewId;
        webview.src = player.url;
        webview.dataset.matchId = activeMatchId;
        webview.dataset.puuid = player.puuid
        webview.setAttribute('partition', 'persist:tracker');
        container.appendChild(webview);
    }
    touchView(viewId);
    evictStaleViews();
    container.querySelectorAll('webview').forEach(v => {
        v.classList.toggle('active', v.id === viewId);
    })
}

async function deleteActiveMatch() {
    if (!activeMatchId) return;

    const toDelete = activeMatchId;
    matchCache.delete(toDelete);
    userSelectedMatch = false;

    const viewsContainer = document.getElementById('views-container');
    Array.from(viewsContainer.querySelectorAll('webview')).filter(v => v.dataset.matchId === toDelete).forEach(v => destroyView(v.id));

    await window.api.deleteMatch(toDelete);

    const sortedRemaining = Array.from(matchCache.values()).sort((a, b) => b.timestamp - a.timestamp);
    if (sortedRemaining.length > 0) {
        activeMatchId = sortedRemaining[0].matchId;
        activePlayerId = sortedRemaining[0].players[0]?.puuid || null;
    } else {
        activeMatchId = null;
        activePlayerId = null;
    }

    renderApp();
}

function goBackInActiveTab() {
    if (!activeMatchId || !activePlayerId) return;
    const activeWebview = document.getElementById(`webview-${activeMatchId}-${activePlayerId}`);
    if (activeWebview && typeof activeWebview.goBack === 'function' && activeWebview.canGoBack()) {
        activeWebview.goBack();
    }
}

async function manualRefresh() {
    document.getElementById('status-text').innerText = "Syncing lobby...";
    try {
        const res = await window.api.fetchPlayers();
        if (res && res.success) {
            handleLobbyPayload(res.data);
        } else {
            document.getElementById('status-text').innerText = "Sync failed.";
        }
    } catch (e) {
        document.getElementById('status-text').innerText = "Error syncing lobby.";
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const saved = await window.api.loadSavedMatches();
    if (saved && Array.isArray(saved)) {
        saved.forEach(m => matchCache.set(m.matchId, m));
    }
    await manualRefresh();

    window.api.onLobbyUpdated((payload) => {
        handleLobbyPayload(payload);
    });
});