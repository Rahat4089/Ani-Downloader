// Dashboard JavaScript

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
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

async function loadDashboard() {
    try {
        // Load library stats
        const libraryResponse = await fetch('/api/library/list');
        const library = await libraryResponse.json();
        
        let totalAnime = 0;
        let totalEpisodes = 0;
        let totalSizeMB = 0;
        let recentItems = [];
        
        if (Array.isArray(library)) {
            // New API format returns array
            totalAnime = library.length;
            library.forEach(anime => {
                totalEpisodes += anime.total_files;
                totalSizeMB += anime.total_size_mb;
                
                recentItems.push({
                    name: anime.name,
                    episodes: anime.total_files,
                    size: anime.total_size_mb
                });
            });
        } else {
            // Old API format returns object
            for (const [animeName, data] of Object.entries(library)) {
                totalAnime++;
                totalEpisodes += data.total_files;
                totalSizeMB += data.total_size_mb;
                
                recentItems.push({
                    name: animeName,
                    episodes: data.total_files,
                    size: data.total_size_mb
                });
            }
        }
        
        // Update stats
        document.getElementById('totalAnime').textContent = totalAnime;
        document.getElementById('totalEpisodes').textContent = totalEpisodes;
        document.getElementById('totalSize').textContent = (totalSizeMB / 1024).toFixed(2) + ' GB';

        // Load server stats
        const serverStatsResponse = await fetch('/api/library/server-stats');
        if (serverStatsResponse.ok) {
            const stats = await serverStatsResponse.json();
            const memory = stats.memory || {};
            const storage = stats.storage || {};
            const load = stats.load_avg || {};

            document.getElementById('serverStatsGrid').innerHTML = `
                <div class="server-metric">
                    <div class="server-metric-label">Series</div>
                    <div class="server-metric-value">${stats.series_count ?? 0}</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-label">Episodes</div>
                    <div class="server-metric-value">${stats.episode_count ?? 0}</div>
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
                    <div class="server-metric-label">RAM Used / Free</div>
                    <div class="server-metric-value">${formatBytes(memory.used_bytes)} / ${formatBytes(memory.free_bytes)}</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-label">Uptime</div>
                    <div class="server-metric-value">${formatUptime(stats.uptime_seconds)}</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-label">CPU Cores</div>
                    <div class="server-metric-value">${stats.cpu_count ?? 'N/A'}</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-label">Load Avg (1/5/15)</div>
                    <div class="server-metric-value">${load['1m'] ?? '-'} / ${load['5m'] ?? '-'} / ${load['15m'] ?? '-'}</div>
                </div>
            `;
        } else {
            document.getElementById('serverStatsGrid').innerHTML =
                '<div class="error">Could not load server stats</div>';
        }
        
        // Load active downloads
        const downloadsResponse = await fetch('/api/download/list');
        const downloads = await downloadsResponse.json();
        const activeDownloads = downloads.filter(d => 
            d.status === 'downloading' || 
            d.status === 'fetching_info' || 
            d.status === 'fetching_episodes' ||
            d.status === 'merging'
        ).length;
        
        document.getElementById('activeDownloads').textContent = activeDownloads;
        
        // Display active downloads
        const activeDownloadsList = document.getElementById('activeDownloadsList');
        const activeJobs = downloads.filter(d => 
            d.status === 'downloading' || 
            d.status === 'fetching_info' || 
            d.status === 'fetching_episodes' ||
            d.status === 'merging' ||
            d.status === 'initializing'
        );
        
        if (activeJobs.length === 0) {
            activeDownloadsList.innerHTML = '<div class="empty-state">No active downloads</div>';
        } else {
            activeDownloadsList.innerHTML = activeJobs.map(job => `
                <div class="job-card">
                    <div class="job-header">
                        <div class="job-title">${job.anime_title || 'Loading...'}</div>
                        <span class="status-badge status-${job.status}">${job.status.replace(/_/g, ' ')}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${job.progress}%"></div>
                    </div>
                    <div class="job-meta" style="margin-top: 8px; color: var(--text-muted); font-size: 0.9em;">
                        ${job.current_episode ? `Episode ${job.current_episode} • ` : ''}
                        ${job.completed_episodes}/${job.total_episodes} episodes
                    </div>
                </div>
            `).join('');
        }
        
        // Display recent downloads
        const recentList = document.getElementById('recentList');
        if (recentItems.length === 0) {
            recentList.innerHTML = '<div class="empty-state">No downloads yet. Start downloading anime!</div>';
        } else {
            recentList.innerHTML = recentItems.slice(0, 5).map(item => `
                <div class="anime-card">
                    <div class="anime-title">${item.name}</div>
                    <div class="anime-stats">
                        <span>🎬 ${item.episodes} episodes</span>
                        <span>💾 ${item.size.toFixed(2)} MB</span>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// Load dashboard on page load
loadDashboard();

// Refresh every 3 seconds to show download progress
setInterval(loadDashboard, 3000);
