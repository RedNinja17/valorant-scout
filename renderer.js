let activeMatchId = null;
let activePlayerId = null;
let userSelectedMatch = false;
let showOverview = true;
let overviewTab = 'roster';
const matchCache = new Map();

const MAX_LIVE_VIEWS = 5;
const view_order = [];

document.getElementById('close-app-btn')?.addEventListener('click', () => {
    if (window.api?.closeApp) {
        window.api.closeApp();
    }
});

function viewIdFor(matchId, puuid) {
    return `webview-${matchId}-${puuid}`;
}

function touchView(viewId) {
    const i = view_order.indexOf(viewId);
    if (i !== -1) view_order.splice(i, 1);
    view_order.push(viewId);
}

function destroyView(viewId) {
    const el = document.getElementById(viewId);
    if (el) el.remove();
    const i = view_order.indexOf(viewId);
    if (i !== -1) view_order.splice(i, 1);
}

function evictStaleViews() {
    const container = document.getElementById('views-container');
    container.querySelectorAll('webview').forEach(v => {
        if (v.dataset.matchId !== activeMatchId) destroyView(v.id);
    });
    const keep = viewIdFor(activeMatchId, activePlayerId);
    while (view_order.length > MAX_LIVE_VIEWS) {
        const oldest = view_order.find(id => id !== keep);
        if (!oldest) break;
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

function setStatus(online, message) {
    document.getElementById('status-indicator').className = online ? 'online' : 'offline';
    document.getElementById('status-text').innerText = message;
}

function setStatusText(message) {
    document.getElementById('status-text').innerText = message;
}

function displayNameFor(player) {
    return player.name.endsWith(' (You)') ? player.name.slice(0, -6) : player.name;
}

function isSelfPlayer(player) {
    if (typeof player.isSelf === 'boolean') return player.isSelf;
    return player.name.endsWith(' (You)');
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
    renderOverview();
    syncWebviewVisibility();
}

function handleLobbyPayload(payload) {
    if (!payload || !payload.players || payload.players.length === 0) {
        setStatus(false, "No match found.");
        return;
    }

    const { matchId, mapName, players, timestamp } = payload;

    if (!matchId || matchId === 'menu') {
        setStatus(false, matchId === 'menu' ? "In Menu." : "No match found.");
        return;
    }

    const key = matchId;
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

        userSelectedMatch = false;
        activeMatchId = key;
        showOverview = true;
        overviewTab = 'roster';
        activePlayerId = null;
    }

    if (!userSelectedMatch) activeMatchId = key;

    const active = matchCache.get(activeMatchId);
    if (active && (!activePlayerId || !active.players.some(p => p.puuid === activePlayerId))) {
        activePlayerId = active.players[0]?.puuid || null;
    }

    setStatus(true, `Active — ${players.length} players`);
    renderApp();
}

function renderMatchHistoryBar() {
    const container = document.getElementById('match-tabs-list');
    container.innerHTML = '';

    const sortedMatches = Array.from(matchCache.values()).sort((a, b) => b.timestamp - a.timestamp);

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
            btn.type = 'button';
            btn.className = `match-tab-btn ${match.matchId === activeMatchId ? 'active' : ''}`;

            const mapEl = document.createElement('span');
            mapEl.className = 'match-map';
            mapEl.innerText = match.mapName;

            const timeEl = document.createElement('span');
            timeEl.className = 'match-time';
            timeEl.innerText = new Date(match.timestamp)
                .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            btn.append(mapEl, timeEl);

            btn.onclick = () => {
                userSelectedMatch = true;
                showOverview = true;
                overviewTab = 'roster';
                activeMatchId = match.matchId;
                activePlayerId = null;
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

    const allyPlayers = players.filter(p => p.isMyTeam);
    const enemyPlayers = players.filter(p => !p.isMyTeam);

    function createTeamGroup(teamPlayers, isAlly) {
        if (teamPlayers.length === 0) return;

        const teamGroup = document.createElement('div');
        teamGroup.className = `team-glass-pill ${isAlly ? 'ally-group' : 'enemy-group'}`;

        teamPlayers.forEach(player => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `player-tab-btn ${(!showOverview && player.puuid === activePlayerId) ? 'active' : ''}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            nameSpan.innerText = displayNameFor(player);
            btn.appendChild(nameSpan);

            btn.onclick = () => openPlayer(player.puuid);
            teamGroup.appendChild(btn);
        });

        tabsBar.appendChild(teamGroup);
    }

    createTeamGroup(allyPlayers, true);

    if (allyPlayers.length > 0 && enemyPlayers.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'team-divider';
        tabsBar.appendChild(divider);
    }

    createTeamGroup(enemyPlayers, false);
}

function renderOverview() {
    const overview = document.getElementById('match-overview');
    const matchPage = document.getElementById('match-page');
    const overviewBtn = document.getElementById('overview-btn');
    const match = matchCache.get(activeMatchId);

    if (!match || !showOverview) {
        overview.classList.remove('active');
        matchPage.classList.remove('active');
        if (overviewBtn) overviewBtn.classList.remove('active');
        return;
    }

    if (overviewBtn) overviewBtn.classList.add('active');
    overview.classList.toggle('active', overviewTab === 'roster');
    matchPage.classList.toggle('active', overviewTab === 'match');

    document.getElementById('overview-map').innerText = match.mapName || 'Match';
    document.getElementById('overview-meta').innerText =
        `${match.players.length} players · ${new Date(match.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const ally = document.getElementById('roster-ally');
    const enemy = document.getElementById('roster-enemy');
    ally.innerHTML = '';
    enemy.innerHTML = '';

    match.players.forEach(player => {
        (player.isMyTeam ? ally : enemy).appendChild(buildPlayerCard(player));
    });

    if (overviewTab === 'match') syncMatchPage(match);
}

function syncMatchPage(match) {
    const matchWebview = document.getElementById('match-webview');
    if (!matchWebview || !match.matchId || match.matchId === 'menu') return;

    const matchUrl = `https://tracker.gg/valorant/match/${match.matchId}`;

    if (!matchWebview.dataset.listenersAttached) {
        matchWebview.dataset.listenersAttached = "true";
        matchWebview.addEventListener('did-fail-load', (e) => {
            console.error('Match webview failed to load:', e);
        });
    }

    if (matchWebview.src !== matchUrl) matchWebview.src = matchUrl;
}

function skeleton(width) {
    const el = document.createElement('span');
    el.className = 'skeleton';
    el.style.width = width;
    return el;
}

function buildPlayerCard(player) {
    const isSelf = isSelfPlayer(player);

    const li = document.createElement('li');
    li.className = `player-card${isSelf ? ' is-self' : ''}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player-card-btn';

    const portrait = document.createElement('span');
    portrait.className = 'player-card-portrait';
    if (player.agentId) {
        const img = document.createElement('img');
        img.src = `https://media.valorant-api.com/agents/${player.agentId}/displayicon.png`;
        img.alt = '';
        portrait.appendChild(img);
    }
    btn.appendChild(portrait);

    const main = document.createElement('span');
    main.className = 'player-card-main';

    const nameRow = document.createElement('span');
    nameRow.className = 'player-card-namerow';

    const nameEl = document.createElement('span');
    nameEl.className = 'player-card-name';
    nameEl.innerText = displayNameFor(player);

    const tagEl = document.createElement('span');
    tagEl.className = 'player-card-tag';
    tagEl.innerText = `#${player.tag}`;

    nameRow.append(nameEl, tagEl);

    const metaRow = document.createElement('span');
    metaRow.className = 'player-card-meta';

    if (player.rank) {
        const rankEl = document.createElement('span');
        rankEl.className = 'player-card-rank';
        rankEl.innerText = player.rank.rr === null
            ? player.rank.tierName
            : `${player.rank.tierName} · ${player.rank.rr} RR`;
        metaRow.appendChild(rankEl);
    } else {
        metaRow.appendChild(skeleton('92px'));
    }

    if (typeof player.accountLevel === 'number') {
        const lvlEl = document.createElement('span');
        lvlEl.className = 'player-card-level';
        lvlEl.innerText = `Lv ${player.accountLevel}`;
        metaRow.appendChild(lvlEl);
    }

    main.append(nameRow, metaRow);
    btn.appendChild(main);

    if (isSelf) {
        const badge = document.createElement('span');
        badge.className = 'player-card-badge';
        badge.innerText = 'YOU';
        btn.appendChild(badge);
    }

    btn.onclick = () => openPlayer(player.puuid);
    li.appendChild(btn);
    return li;
}

function openPlayer(puuid) {
    activePlayerId = puuid;
    showOverview = false;
    renderApp();
}

function syncWebviewVisibility() {
    const container = document.getElementById('views-container');
    const currentMatch = matchCache.get(activeMatchId);

    if (showOverview && currentMatch) {
        container.classList.remove('active');
        container.querySelectorAll('webview').forEach(v => v.classList.remove('active'));
        clearEmptyState();
        return;
    }

    container.classList.add('active');

    if (!currentMatch || !activePlayerId) {
        showEmptyState(matchCache.size === 0 ? "No matches saved." : "No active match.");
        return;
    }

    const player = currentMatch.players.find(p => p.puuid === activePlayerId);
    if (!player) {
        showEmptyState("Player not found in this match.");
        return;
    }
    clearEmptyState();

    const viewId = viewIdFor(activeMatchId, activePlayerId);
    let webview = document.getElementById(viewId);
    if (!webview) {
        webview = document.createElement('webview');
        webview.id = viewId;
        webview.src = player.url;
        webview.dataset.matchId = activeMatchId;
        webview.dataset.puuid = player.puuid;
        webview.setAttribute('partition', 'persist:tracker');
        webview.setAttribute(
            'useragent',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );
        webview.setAttribute('allowpopups', '');
        container.appendChild(webview);
    }

    touchView(viewId);
    evictStaleViews();

    container.querySelectorAll('webview').forEach(v => {
        v.classList.toggle('active', v.id === viewId);
    });
}

async function deleteActiveMatch() {
    if (!activeMatchId) return;

    const toDelete = activeMatchId;
    matchCache.delete(toDelete);
    userSelectedMatch = false;

    const viewsContainer = document.getElementById('views-container');
    Array.from(viewsContainer.querySelectorAll('webview'))
        .filter(v => v.dataset.matchId === toDelete)
        .forEach(v => destroyView(v.id));

    await window.api.deleteMatch(toDelete);

    const sortedRemaining = Array.from(matchCache.values()).sort((a, b) => b.timestamp - a.timestamp);
    if (sortedRemaining.length > 0) {
        activeMatchId = sortedRemaining[0].matchId;
        activePlayerId = sortedRemaining[0].players[0]?.puuid || null;
        showOverview = true;
        overviewTab = 'roster';
    } else {
        activeMatchId = null;
        activePlayerId = null;
    }

    renderApp();
}

function goBackInActiveTab() {
    let activeWebview = null;

    if (showOverview && overviewTab === 'match') {
        activeWebview = document.getElementById('match-webview');
    } else if (!showOverview && activeMatchId && activePlayerId) {
        activeWebview = document.getElementById(viewIdFor(activeMatchId, activePlayerId));
    }

    if (!activeWebview) return;

    try {
        if (activeWebview.canGoBack()) activeWebview.goBack();
    } catch (e) {
        console.warn('Webview not ready for goBack:', e.message);
    }
}

async function manualRefresh() {
    setStatusText("SYNCING LOBBY…");

    if (!window.api) {
        setStatus(false, "API UNAVAILABLE");
        console.error("window.api is not defined. Check your Electron preload script.");
        return;
    }

    try {
        const res = await window.api.fetchPlayers();
        if (res && res.success) {
            handleLobbyPayload(res.data);
        } else {
            setStatus(false, res?.error ? `SYNC FAILED: ${res.error.toUpperCase()}` : "SYNC FAILED");
        }
    } catch (e) {
        console.error('Lobby sync failed:', e);
        setStatus(false, "ERROR SYNCING LOBBY");
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('overview-btn').addEventListener('click', () => {
        showOverview = true;
        overviewTab = 'roster';
        renderApp();
    });
    document.getElementById('match-page-btn').addEventListener('click', () => {
        overviewTab = overviewTab === 'roster' ? 'match' : 'roster';
        renderApp();
    });
    document.getElementById('back-btn').addEventListener('click', goBackInActiveTab);
    document.getElementById('refresh-btn').addEventListener('click', manualRefresh);
    document.getElementById('delete-btn').addEventListener('click', deleteActiveMatch);

    const saved = await window.api.loadSavedMatches();
    if (saved && Array.isArray(saved)) {
        saved.forEach(m => matchCache.set(m.matchId, m));
    }
    renderApp();

    await manualRefresh();

    window.api.onLobbyUpdated((payload) => {
        handleLobbyPayload(payload);
    });
});