function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatUptime(seconds) {
    if (!Number.isFinite(seconds)) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

async function loadServerStats() {
    try {
        const response = await fetch('/api/library/server-stats');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const stats = await response.json();
        const memory = stats.memory || {};
        const storage = stats.storage || {};
        const load = stats.load_avg || {};

        document.getElementById('server-stats-grid').innerHTML = `
            <div class="server-metric">
                <div class="server-metric-label">Series</div>
                <div class="server-metric-value">${stats.series_count ?? 0}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Episodes</div>
                <div class="server-metric-value">${stats.episode_count ?? 0}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Playable Video Files</div>
                <div class="server-metric-value">${stats.video_files_count ?? 0}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Library Size</div>
                <div class="server-metric-value">${formatBytes(stats.library_size_bytes)}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Disk Used / Free</div>
                <div class="server-metric-value">${formatBytes(storage.used_bytes)} / ${formatBytes(storage.free_bytes)}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Disk Total</div>
                <div class="server-metric-value">${formatBytes(storage.total_bytes)}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">RAM Used / Free</div>
                <div class="server-metric-value">${formatBytes(memory.used_bytes)} / ${formatBytes(memory.free_bytes)}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">RAM Total</div>
                <div class="server-metric-value">${formatBytes(memory.total_bytes)}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">CPU Cores</div>
                <div class="server-metric-value">${stats.cpu_count ?? 'N/A'}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Load Avg (1/5/15)</div>
                <div class="server-metric-value">${load['1m'] ?? '-'} / ${load['5m'] ?? '-'} / ${load['15m'] ?? '-'}</div>
            </div>
            <div class="server-metric">
                <div class="server-metric-label">Uptime</div>
                <div class="server-metric-value">${formatUptime(stats.uptime_seconds)}</div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading server stats:', error);
        document.getElementById('server-stats-grid').innerHTML =
            '<div class="error">Failed to load server stats</div>';
    }
}

loadServerStats();
setInterval(loadServerStats, 10000);
