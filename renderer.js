let activeMatchId = null;
let activePlayerId = null;
const matchCache = new Map(); // Key: matchId, Value: matchObj

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

    if (matchCache.has(key)) {
        // Match already exists: update players/mapName, BUT PRESERVE original timestamp
        const existing = matchCache.get(key);
        existing.players = players;
        existing.mapName = mapName || existing.mapName;
    } else {
        // New match: set it with the provided timestamp
        matchCache.set(key, {
            matchId: key,
            mapName: mapName || 'Match',
            timestamp: timestamp || Date.now(),
            players: players
        });
    }

    // Automatically highlight incoming live match
    activeMatchId = key;
    if (!activePlayerId || !players.some(p => p.puuid === activePlayerId)) {
        activePlayerId = players[0]?.puuid || null;
    }

    document.getElementById('status-indicator').className = "online";
    document.getElementById('status-text').innerText = `Active (${players.length} Players Found)`;

    renderApp();
}

function renderMatchHistoryBar() {
    const container = document.getElementById('match-tabs-list');
    container.innerHTML = '';

    // Sort matches: newest timestamp first
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
    const viewsContainer = document.getElementById('views-container');
    const emptyState = viewsContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const currentMatch = matchCache.get(activeMatchId);
    if (!currentMatch) return;

    currentMatch.players.forEach((player) => {
        const viewId = `webview-${activeMatchId}-${player.puuid}`;
        let webview = document.getElementById(viewId);

        if (!webview) {
            webview = document.createElement('webview');
            webview.id = viewId;
            webview.src = player.url;
            webview.dataset.matchId = activeMatchId;
            webview.dataset.puuid = player.puuid;
            viewsContainer.appendChild(webview);
        }
    });

    const allViews = viewsContainer.querySelectorAll('webview');
    allViews.forEach(v => {
        const isSelectedView = (v.dataset.matchId === activeMatchId && v.dataset.puuid === activePlayerId);
        v.classList.toggle('active', isSelectedView);
    });
}

async function deleteActiveMatch() {
    if (!activeMatchId) return;

    const toDelete = activeMatchId;
    matchCache.delete(toDelete);

    // Remove matching Webviews from DOM
    const viewsContainer = document.getElementById('views-container');
    const viewsToRemove = viewsContainer.querySelectorAll(`webview[data-match-id="${toDelete}"]`);
    viewsToRemove.forEach(v => v.remove());

    // Delete file from disk
    await window.api.deleteMatch(toDelete);

    // Re-assign active match to newest available
    const sortedRemaining = Array.from(matchCache.values()).sort((a, b) => b.timestamp - a.timestamp);
    if (sortedRemaining.length > 0) {
        activeMatchId = sortedRemaining[0].matchId;
        activePlayerId = sortedRemaining[0].players[0]?.puuid || null;
    } else {
        activeMatchId = null;
        activePlayerId = null;
        viewsContainer.innerHTML = '<div class="empty-state"><p>No matches saved.</p></div>';
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
    // 1. Load saved matches from disk first
    const saved = await window.api.loadSavedMatches();
    if (saved && Array.isArray(saved)) {
        saved.forEach(m => matchCache.set(m.matchId, m));
    }

    // 2. Fetch live match
    await manualRefresh();

    // 3. Listen for automated background polling
    window.api.onLobbyUpdated((payload) => {
        handleLobbyPayload(payload);
    });
});