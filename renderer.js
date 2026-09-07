let activeTabId = null;

function renderLobby(players) {
    const statusText = document.getElementById('status-text');
    const tabsBar = document.getElementById('tabs-bar');
    const viewsContainer = document.getElementById('views-container');

    if (!players || players.length === 0) {
        statusText.innerText = "No players found or Valorant not in match.";
        tabsBar.innerHTML = '';
        viewsContainer.innerHTML = '<div class="empty-state">Waiting for active match...</div>';
        activeTabId = null;
        return;
    }

    statusText.innerText = `Connected (${players.length} players found)`;

    // PREVENT RELOAD: Compare against data-raw-url instead of v.src
    const currentWebviews = viewsContainer.querySelectorAll('webview');
    const currentUrls = Array.from(currentWebviews).map(v => v.dataset.rawUrl);
    const newUrls = players.map(p => p.url);

    if (currentUrls.length > 0 && JSON.stringify(currentUrls) === JSON.stringify(newUrls)) {
        return; // URLs match stored state; skip DOM teardown
    }

    // Rebuild tabs and webviews only when players actually change
    tabsBar.innerHTML = '';
    viewsContainer.innerHTML = '';

    players.forEach((player, index) => {
        const tabId = `view-${index}`;

        // 1. Create Tab Button
        const btn = document.createElement('button');
        btn.className = `tab-btn ${index === 0 ? 'active' : ''}`;

        if (player.team) {
            const dot = document.createElement('span');
            dot.className = `team-dot ${player.team}`;
            btn.appendChild(dot);
        }

        const nameSpan = document.createElement('span');
        nameSpan.innerText = player.name;
        btn.appendChild(nameSpan);

        btn.onclick = () => switchTab(tabId);
        tabsBar.appendChild(btn);

        // 2. Create Webview
        const webview = document.createElement('webview');
        webview.id = tabId;
        webview.src = player.url;
        webview.dataset.rawUrl = player.url; // Fixes redirect URL comparison
        webview.className = index === 0 ? 'active' : '';
        viewsContainer.appendChild(webview);

        if (index === 0) activeTabId = tabId;
    });
}

function switchTab(tabId) {
    activeTabId = tabId;

    // Toggle active class for webviews
    document.querySelectorAll('webview').forEach(view => {
        view.classList.toggle('active', view.id === tabId);
    });

    // Toggle active class for tab buttons
    document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', `view-${idx}` === tabId);
    });
}

function goBackInActiveTab() {
    if (!activeTabId) return;
    const activeWebview = document.getElementById(activeTabId);
    if (activeWebview && typeof activeWebview.goBack === 'function' && activeWebview.canGoBack()) {
        activeWebview.goBack();
    }
}

async function manualRefresh() {
    const statusText = document.getElementById('status-text');
    statusText.innerText = "Syncing lobby...";
    try {
        const res = await window.api.fetchPlayers();
        if (res && res.success) {
            renderLobby(res.data);
        } else {
            statusText.innerText = "Sync failed.";
        }
    } catch (e) {
        console.error("Refresh error:", e);
        statusText.innerText = "Error syncing lobby.";
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await manualRefresh();

    window.api.onLobbyUpdated((players) => {
        renderLobby(players);
    });
});