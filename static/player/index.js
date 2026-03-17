import { PlayerCore } from "./core.js";
import { SubtitleController } from "./subtitles.js";
import { PlaybackAnalytics } from "./analytics.js";
import { PlayerUI } from "./ui.js";

class AnimeStreamingPlayerApp {
    constructor(rootElement) {
        this.root = rootElement;
        this.animeName = this.root.dataset.animeName || "Unknown Anime";
        this.playerCore = null;
        this.subtitles = null;
        this.analytics = null;
        this.ui = null;
        this.config = null;
        this.currentEpisodeIndex = 0;
        this.currentEpisode = null;
        this.autoNextTimer = null;
        this.autoNextRemaining = 0;
        this.touchStart = null;
        this.lastTap = { side: "", ts: 0 };
        this.resumeSaveSecond = -1;
        this.locked = false;
        this.centerTapTimer = null;
        this.lastTouchTapAt = 0;
    }

    async init() {
        if (!document.createElement("video").canPlayType) {
            this.root.innerHTML = "<div class='error'>Your browser does not support HTML5 video playback.</div>";
            return;
        }

        try {
            this.config = await this.loadConfig();
        } catch (error) {
            this.root.innerHTML = "<div class='error'>Failed to load anime stream configuration.</div>";
            return;
        }
        if (!this.config?.episodes?.length) {
            this.root.innerHTML = "<div class='ap-empty-state'>No episodes available for this anime yet.</div>";
            return;
        }

        this.ui = new PlayerUI(this.root, {
            onAction: (action) => this.handleAction(action),
            onSeekPercent: (percent) => this.seekPercent(percent),
            onVolumeChange: (volume) => this.setVolume(volume),
            onSpeedChange: (speed) => this.setSpeed(speed),
            onServerChange: (serverIndex) => this.switchServer(Number(serverIndex)),
            onQualityChange: (qualityId) => this.playerCore?.setQuality(qualityId),
            onAudioTrackChange: (trackId) => this.playerCore?.setAudioTrack(trackId),
            onSubtitleTrackChange: (trackId) => this.subtitles?.setActiveTrack(trackId),
            onEpisodeSelect: (index) => { if (!this.locked) this.loadEpisode(index, true); },
            onDeleteEpisode: (index) => { if (!this.locked) this.deleteEpisode(index); }
        });

        this.playerCore = new PlayerCore(this.ui.video, {
            onState: (state) => this.onCoreState(state),
            onError: (error) => this.onCoreError(error),
            onQualityOptions: (options, selectedId) => this.onQualityOptions(options, selectedId),
            onAudioTracks: (tracks, selectedId) => this.onAudioTracks(tracks, selectedId)
        });

        this.subtitles = new SubtitleController(this.ui.video);
        this.analytics = new PlaybackAnalytics(this.animeName, (payload) => {
            window.animePlayerHooks?.onAnalytics?.(payload);
        });

        this.ui.video.setAttribute("x-webkit-airplay", "allow");
        this.ui.video.disableRemotePlayback = false;

        this.attachVideoEvents();
        this.attachGestures();
        this.attachKeyboardShortcuts();
        document.addEventListener("fullscreenchange", () => {
            if (!document.fullscreenElement && screen.orientation?.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (error) {
                    console.debug("Orientation unlock unavailable:", error);
                }
            }
        });

        const startIndex = this.getInitialEpisodeIndex();
        this.loadEpisode(startIndex, false);
        window.animePlayerHooks?.onPlayerReady?.({
            anime_name: this.animeName,
            episodes: this.config.episodes.length
        });
    }

    async loadConfig() {
        if (window.ANIME_PLAYER_CONFIG) {
            return this.normalizeConfig(window.ANIME_PLAYER_CONFIG);
        }

        const apiUrl = `/api/library/player-config/${encodeURIComponent(this.animeName)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
            if (response.status === 404) {
                let payload = null;
                try {
                    payload = await response.json();
                } catch (error) {
                    payload = null;
                }
                if (payload?.error?.toLowerCase?.().includes("no playable files")) {
                    return { anime_name: this.animeName, episodes: [] };
                }
            }
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        return this.normalizeConfig(payload);
    }

    normalizeConfig(payload) {
        if (Array.isArray(payload?.episodes)) return payload;

        // Accept direct single-episode config shape requested by API contracts.
        if (Array.isArray(payload?.video_sources)) {
            return {
                anime_name: this.animeName,
                ui_language: "en",
                seek_short_seconds: 10,
                seek_long_seconds: 30,
                auto_next_seconds: 8,
                episodes: [{
                    id: "episode-1",
                    filename: "episode-1",
                    download_url: "",
                    delete_url: "",
                    episode_number: 1,
                    thumbnail: "/static/player/episode-placeholder.svg",
                    metadata: {
                        title: "Episode 1",
                        synopsis: "Single config payload loaded."
                    },
                    config: {
                        video_sources: payload.video_sources || [],
                        subtitles: payload.subtitles || [],
                        audio_tracks: payload.audio_tracks || [],
                        intro_start: payload.intro_start || 0,
                        intro_end: payload.intro_end || 0,
                        outro_start: payload.outro_start || 0,
                        outro_end: payload.outro_end || 0,
                        next_episode_url: payload.next_episode_url || "",
                        timeline_thumbnails: payload.timeline_thumbnails || []
                    }
                }]
            };
        }
        return payload;
    }

    getInitialEpisodeIndex() {
        const hash = window.location.hash || "";
        const match = hash.match(/ep=(\d+)/i);
        if (!match) return 0;
        const epNumber = Number.parseInt(match[1], 10);
        if (!Number.isFinite(epNumber) || epNumber <= 0) return 0;
        return Math.min(this.config.episodes.length - 1, epNumber - 1);
    }

    async loadEpisode(index, autoplay = true) {
        const boundedIndex = Math.max(0, Math.min(index, this.config.episodes.length - 1));
        const episode = this.config.episodes[boundedIndex];
        if (!episode) return;

        this.currentEpisodeIndex = boundedIndex;
        this.currentEpisode = episode;
        this.resumeSaveSecond = -1;

        const episodesForUi = this.config.episodes.map((item) => ({
            ...item,
            download_url: item.download_url || `/api/library/download/${encodeURIComponent(this.animeName)}/${encodeURIComponent(item.filename || item.id || "")}`
        }));
        this.ui.setEpisodes(episodesForUi, boundedIndex);
        this.ui.setServerOptions(episode.config.video_sources || [], "0");
        this.ui.setError("");
        this.ui.clearEpisodeSelection();

        this.subtitles.loadTracks(episode.config.subtitles || []);
        const subtitleOptions = this.subtitles.getTrackOptions();
        this.ui.setSubtitleOptions(subtitleOptions, subtitleOptions.find((item) => item.id !== "off")?.id || "off");

        const resumeTime = this.readResumeTime(episode.id);
        const loaded = await this.playerCore.loadSources(episode.config.video_sources || [], {
            autoplay,
            startTime: resumeTime
        });
        if (!loaded) return;

        this.playerCore.preloadUrl(this.getNextEpisodeFirstSourceUrl());
        this.analytics.start(episode.id);
        this.syncProgress({ event: "episode_loaded" });
        this.ui.revealControls();
    }

    attachVideoEvents() {
        const video = this.ui.video;

        video.addEventListener("timeupdate", () => {
            this.ui.updateTime(video.currentTime, video.duration);
            this.saveResumeTimePeriodic(video.currentTime);
            this.syncProgress({ event: "time_update" });
        });

        video.addEventListener("play", () => {
            this.ui.setPlayState(true);
            this.ui.hideControlsSoon();
        });
        video.addEventListener("pause", () => {
            this.ui.setPlayState(false);
            this.analytics.markDropOff(video.currentTime, video.duration || 0);
            this.saveResumeTime(video.currentTime);
            this.ui.revealControls();
        });
        video.addEventListener("ended", () => {
            this.analytics.markCompleted(video.duration || 0);
            this.saveResumeTime(0);
            this.nextEpisode();
        });
        video.addEventListener("volumechange", () => { this.ui.volume.value = String(video.volume); });
        video.addEventListener("click", (event) => this.handleTapToggle(event));
        video.addEventListener("dblclick", (event) => {
            event.preventDefault();
            this.handleDoubleTapSeek(event);
        });
    }

    attachGestures() {
        const video = this.ui.video;
        video.addEventListener("touchstart", (event) => {
            if (!event.touches.length) return;
            this.touchStart = {
                x: event.touches[0].clientX,
                y: event.touches[0].clientY,
                ts: Date.now()
            };
        }, { passive: true });

        video.addEventListener("touchend", (event) => {
            if (!this.touchStart || !event.changedTouches.length) return;
            const endX = event.changedTouches[0].clientX;
            const endY = event.changedTouches[0].clientY;
            const deltaX = endX - this.touchStart.x;
            const deltaY = endY - this.touchStart.y;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            const elapsed = Date.now() - this.touchStart.ts;
            this.touchStart = null;

            if (elapsed < 260 && absX < 20 && absY < 20) {
                event.preventDefault();
                this.lastTouchTapAt = Date.now();
                this.handleTapToggle({ clientX: endX, clientY: endY, type: "touch" });
            }
        }, { passive: false });
    }

    attachKeyboardShortcuts() {
        document.addEventListener("keydown", (event) => {
            const activeTag = document.activeElement?.tagName?.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") return;

            const key = event.key.toLowerCase();
            if (this.locked && key !== "u") return;
            if (event.code === "Space") {
                event.preventDefault();
                this.togglePlayback();
            } else if (event.code === "ArrowLeft") {
                event.preventDefault();
                this.seekRelative(-this.getShortSeek());
            } else if (event.code === "ArrowRight") {
                event.preventDefault();
                this.seekRelative(this.getShortSeek());
            } else if (event.code === "ArrowUp") {
                event.preventDefault();
                this.setVolume(Math.min(1, this.ui.video.volume + 0.05));
            } else if (event.code === "ArrowDown") {
                event.preventDefault();
                this.setVolume(Math.max(0, this.ui.video.volume - 0.05));
            } else if (key === "m") {
                this.toggleOptionsMenu();
            } else if (key === "f") {
                this.toggleFullscreen();
            } else if (key === "n") {
                this.nextEpisode();
            } else if (key === "p") {
                this.prevEpisode();
            } else if (key === "u") {
                this.toggleLock();
            }
        });
    }

    handleAction(action) {
        if (this.locked && action !== "toggle-lock") return;
        this.ui.revealControls();
        if (action === "play-pause") this.togglePlayback();
        else if (action === "back-10") this.seekRelative(-this.getShortSeek());
        else if (action === "forward-10") this.seekRelative(this.getShortSeek());
        else if (action === "prev-episode") this.prevEpisode();
        else if (action === "next-episode") this.nextEpisode();
        else if (action === "fullscreen") this.toggleFullscreen();
        else if (action === "retry") this.playerCore.retry({ autoplay: true, startTime: this.ui.video.currentTime });
        else if (action === "switch-server") this.switchServer(this.playerCore.currentServerIndex + 1);
        else if (action === "toggle-options") this.toggleOptionsMenu();
        else if (action === "scroll-episodes") this.ui.scrollToEpisodeList();
        else if (action === "toggle-lock") this.toggleLock();
        else if (action === "delete-selected-episodes") this.deleteSelectedEpisodes();
        else if (action === "delete-series") this.deleteSeries();
    }

    onCoreState(state) {
        this.ui.setBuffering(state === "buffering");
        if (state === "playing") this.ui.setError("");
        if (state === "ended") this.ui.setPlayState(false);
    }

    onCoreError(error) {
        this.ui.setBuffering(false);
        this.ui.setError(error?.message || "Playback error");
        this.syncProgress({ event: "error", error: error?.message || "unknown" });
    }

    onQualityOptions(options, selectedId) {
        this.ui.setQualityOptions(options, selectedId);
    }

    onAudioTracks(tracks, selectedId) {
        this.ui.setAudioOptions(tracks, selectedId);
    }

    handleTapToggle(event) {
        if (this.locked) return;
        if (event.type === "click" && Date.now() - this.lastTouchTapAt < 450) return;
        this.ui.revealControls();
        const rect = this.ui.video.getBoundingClientRect();
        const ratioX = (event.clientX - rect.left) / rect.width;
        const side = ratioX < 0.35 ? "left" : ratioX > 0.65 ? "right" : "center";

        if (event.type === "touch") {
            const now = Date.now();
            if (this.lastTap.side === side && now - this.lastTap.ts < 280 && side !== "center") {
                this.seekRelative(side === "left" ? -this.getShortSeek() : this.getShortSeek());
                this.ui.showSeekToast(side === "left" ? `-${this.getShortSeek()}s` : `+${this.getShortSeek()}s`);
                this.lastTap = { side: "", ts: 0 };
                return;
            }
            this.lastTap = { side, ts: now };
        }

        if (side === "center") {
            clearTimeout(this.centerTapTimer);
            this.centerTapTimer = setTimeout(() => {
                this.togglePlayback();
            }, 230);
        }
    }

    handleDoubleTapSeek(event) {
        if (this.locked) return;
        clearTimeout(this.centerTapTimer);
        const rect = this.ui.video.getBoundingClientRect();
        const ratioX = (event.clientX - rect.left) / rect.width;
        if (ratioX < 0.4) {
            this.seekRelative(-this.getShortSeek());
            this.ui.showSeekToast(`-${this.getShortSeek()}s`);
        } else if (ratioX > 0.6) {
            this.seekRelative(this.getShortSeek());
            this.ui.showSeekToast(`+${this.getShortSeek()}s`);
        }
    }

    seekPercent(percent) {
        if (this.locked) return;
        if (!Number.isFinite(this.ui.video.duration) || this.ui.video.duration <= 0) return;
        this.ui.video.currentTime = (percent / 100) * this.ui.video.duration;
    }

    setVolume(volume) {
        if (this.locked) return;
        this.ui.video.volume = Math.max(0, Math.min(1, volume));
        this.ui.video.muted = this.ui.video.volume === 0;
    }

    setSpeed(speed) {
        if (this.locked) return;
        this.ui.video.playbackRate = Math.max(0.25, Math.min(3, speed));
    }

    async togglePlayback() {
        if (this.locked) return;
        if (!this.ui.video.src) return;
        if (this.ui.video.paused) {
            try {
                await this.ui.video.play();
                this.ui.showPlayPulse(true);
            } catch (error) {
                console.debug("Autoplay blocked:", error);
            }
        } else {
            this.ui.video.pause();
            this.ui.showPlayPulse(false);
        }
    }

    seekRelative(seconds) {
        if (this.locked) return;
        if (!Number.isFinite(this.ui.video.duration)) return;
        const nextTime = Math.min(
            this.ui.video.duration,
            Math.max(0, this.ui.video.currentTime + seconds)
        );
        this.ui.video.currentTime = nextTime;
    }

    async switchServer(index) {
        const total = this.currentEpisode?.config?.video_sources?.length || 0;
        if (!total) return;
        const normalized = ((index % total) + total) % total;
        const currentTime = this.ui.video.currentTime || 0;
        const autoplay = !this.ui.video.paused;
        const switched = await this.playerCore.switchServer(normalized, { startTime: currentTime, autoplay });
        if (switched) {
            this.ui.setServerOptions(this.currentEpisode.config.video_sources, String(normalized));
        }
    }

    prevEpisode() {
        this.loadEpisode(Math.max(0, this.currentEpisodeIndex - 1), true);
    }

    nextEpisode() {
        const nextIndex = this.currentEpisodeIndex + 1;
        if (nextIndex >= this.config.episodes.length) return;
        this.loadEpisode(nextIndex, true);
    }

    async toggleFullscreen() {
        if (this.locked) return;
        const target = this.ui.videoWrap;
        if (!document.fullscreenElement) {
            await target.requestFullscreen();
            if (screen.orientation?.lock) {
                try {
                    await screen.orientation.lock("landscape");
                } catch (error) {
                    console.debug("Landscape lock unavailable:", error);
                }
            }
        } else {
            await document.exitFullscreen();
            if (screen.orientation?.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (error) {
                    console.debug("Orientation unlock unavailable:", error);
                }
            }
        }
    }

    toggleOptionsMenu() {
        if (this.locked) return;
        this.ui.toggleOptionsMenu();
    }

    toggleLock() {
        this.locked = !this.locked;
        this.ui.setLocked(this.locked);
    }

    async deleteEpisode(index) {
        const episode = this.config.episodes[index];
        if (!episode) return;
        const confirmed = window.confirm(`Delete episode?\n\n${episode.filename}`);
        if (!confirmed) return;

        try {
            const response = await fetch(episode.delete_url || `/api/library/anime/${encodeURIComponent(this.animeName)}/file/${encodeURIComponent(episode.filename)}`, {
                method: "DELETE"
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await this.reloadConfigAndPreserve(Math.max(0, this.currentEpisodeIndex - (index <= this.currentEpisodeIndex ? 1 : 0)));
        } catch (error) {
            this.ui.setError(`Delete failed: ${error.message}`);
        }
    }

    async deleteSelectedEpisodes() {
        const indexes = this.ui.getSelectedEpisodeIndexes();
        if (!indexes.length) return;
        const filenames = indexes.map((index) => this.config.episodes[index]?.filename).filter(Boolean);
        if (!filenames.length) return;

        const confirmed = window.confirm(`Delete ${filenames.length} selected episode(s)?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/library/anime/${encodeURIComponent(this.animeName)}/files`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filenames })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await this.reloadConfigAndPreserve(Math.max(0, this.currentEpisodeIndex));
        } catch (error) {
            this.ui.setError(`Bulk delete failed: ${error.message}`);
        }
    }

    async deleteSeries() {
        const confirmed = window.confirm(`Delete full series?\n\n${this.animeName}`);
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/library/anime/${encodeURIComponent(this.animeName)}`, { method: "DELETE" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            window.location.href = "/library";
        } catch (error) {
            this.ui.setError(`Series delete failed: ${error.message}`);
        }
    }

    async reloadConfigAndPreserve(targetIndex) {
        const refreshed = await this.loadConfig();
        if (!refreshed?.episodes?.length) {
            window.location.href = "/library";
            return;
        }
        this.config = refreshed;
        const safeIndex = Math.max(0, Math.min(targetIndex, this.config.episodes.length - 1));
        await this.loadEpisode(safeIndex, false);
    }

    getResumeKey(episodeId) {
        return `anime-player-resume:${this.animeName}:${episodeId}`;
    }

    readResumeTime(episodeId) {
        const value = Number(localStorage.getItem(this.getResumeKey(episodeId)));
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    saveResumeTime(currentTime) {
        if (!this.currentEpisode) return;
        const duration = this.ui.video.duration || 0;
        const saveValue = currentTime > 1 && currentTime < duration - 5 ? currentTime : 0;
        localStorage.setItem(this.getResumeKey(this.currentEpisode.id), String(saveValue));
    }

    saveResumeTimePeriodic(currentTime) {
        const rounded = Math.floor(currentTime);
        if (rounded % 5 !== 0 || rounded === this.resumeSaveSecond) return;
        this.resumeSaveSecond = rounded;
        this.saveResumeTime(currentTime);
    }

    syncProgress(extra = {}) {
        if (!window.animePlayerHooks?.onProgressSync || !this.currentEpisode) return;
        window.animePlayerHooks.onProgressSync({
            anime_name: this.animeName,
            episode_id: this.currentEpisode.id,
            episode_number: this.currentEpisode.episode_number,
            current_time: this.ui.video.currentTime || 0,
            duration: this.ui.video.duration || 0,
            ...extra
        });
    }

    getNextEpisodeFirstSourceUrl() {
        const next = this.config.episodes[this.currentEpisodeIndex + 1];
        return next?.config?.video_sources?.[0]?.url || "";
    }

    getShortSeek() {
        return Number(this.config.seek_short_seconds || 10);
    }

}

function bootPlayer() {
    const root = document.getElementById("anime-player-root");
    if (!root) return;

    const app = new AnimeStreamingPlayerApp(root);
    const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            app.init();
        }
    }, { threshold: 0.1 });
    observer.observe(root);
}

bootPlayer();
