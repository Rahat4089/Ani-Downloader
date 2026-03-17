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
    }

    async init() {
        if (!document.createElement("video").canPlayType) {
            this.root.innerHTML = "<div class='error'>Your browser does not support HTML5 video playback.</div>";
            return;
        }

        this.config = await this.loadConfig();
        if (!this.config?.episodes?.length) {
            this.root.innerHTML = "<div class='error'>No episodes found for this anime.</div>";
            return;
        }

        this.ui = new PlayerUI(this.root, {
            onAction: (action) => this.handleAction(action),
            onSeekPercent: (percent) => this.seekPercent(percent),
            onPreviewHover: (ratio, leftPx) => this.handlePreviewHover(ratio, leftPx),
            onVolumeChange: (volume) => this.setVolume(volume),
            onSpeedChange: (speed) => this.setSpeed(speed),
            onServerChange: (serverIndex) => this.switchServer(Number(serverIndex)),
            onQualityChange: (qualityId) => this.playerCore?.setQuality(qualityId),
            onAudioTrackChange: (trackId) => this.playerCore?.setAudioTrack(trackId),
            onSubtitleTrackChange: (trackId) => this.subtitles?.setActiveTrack(trackId),
            onSubtitleStyleChange: (stylePatch) => this.subtitles?.applyStyle(stylePatch),
            onEpisodeSelect: (index) => this.loadEpisode(index, true)
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
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            return this.normalizeConfig(payload);
        } catch (error) {
            console.warn("Player config API failed, loading demo config:", error);
            const fallback = await fetch("/static/player/demo_config.json");
            const payload = await fallback.json();
            return this.normalizeConfig(payload);
        }
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

        this.clearAutoNext();
        this.currentEpisodeIndex = boundedIndex;
        this.currentEpisode = episode;
        this.resumeSaveSecond = -1;

        this.ui.setEpisodes(this.config.episodes, boundedIndex);
        this.ui.setEpisodeMeta(episode.metadata?.title, episode.metadata?.synopsis);
        this.ui.setServerOptions(episode.config.video_sources || [], "0");
        this.ui.setServerChip(episode.config.video_sources?.[0]?.label || "Server");
        this.ui.setError("");
        this.ui.setStatus("Loading");

        this.subtitles.loadTracks(episode.config.subtitles || []);
        const subtitleOptions = this.subtitles.getTrackOptions();
        this.ui.setSubtitleOptions(subtitleOptions, subtitleOptions.find((item) => item.id !== "off")?.id || "off");
        this.ui.setSoftSubtitleStatus((episode.config.subtitles || []).length > 0);

        const resumeTime = this.readResumeTime(episode.id);
        const loaded = await this.playerCore.loadSources(episode.config.video_sources || [], {
            autoplay,
            startTime: resumeTime
        });
        if (!loaded) return;

        this.playerCore.preloadUrl(this.getNextEpisodeFirstSourceUrl());
        this.ui.setAudioStatus("Audio: Default");
        this.analytics.start(episode.id);
        this.syncProgress({ event: "episode_loaded" });
        this.requestIntroDetectionIfEnabled(episode);
    }

    async requestIntroDetectionIfEnabled(episode) {
        if (!window.animePlayerHooks?.onIntroDetectionRequest) return;
        try {
            const detection = await window.animePlayerHooks.onIntroDetectionRequest({
                anime_name: this.animeName,
                episode_id: episode.id
            });
            if (!detection) return;
            if (Number.isFinite(detection.intro_start)) episode.config.intro_start = detection.intro_start;
            if (Number.isFinite(detection.intro_end)) episode.config.intro_end = detection.intro_end;
            if (Number.isFinite(detection.outro_start)) episode.config.outro_start = detection.outro_start;
            if (Number.isFinite(detection.outro_end)) episode.config.outro_end = detection.outro_end;
        } catch (error) {
            console.debug("Intro detection hook failed:", error);
        }
    }

    attachVideoEvents() {
        const video = this.ui.video;

        video.addEventListener("timeupdate", () => {
            this.ui.updateTime(video.currentTime, video.duration);
            this.updateSkipButtons(video.currentTime);
            this.saveResumeTimePeriodic(video.currentTime);
            this.syncProgress({ event: "time_update" });
        });

        video.addEventListener("play", () => {
            this.ui.setPlayState(true);
            this.ui.setStatus("Playing");
        });
        video.addEventListener("pause", () => {
            this.ui.setPlayState(false);
            this.ui.setStatus("Paused");
            this.analytics.markDropOff(video.currentTime, video.duration || 0);
            this.saveResumeTime(video.currentTime);
        });
        video.addEventListener("ended", () => {
            this.analytics.markCompleted(video.duration || 0);
            this.saveResumeTime(0);
            this.startAutoNextCountdown();
        });
        video.addEventListener("volumechange", () => {
            this.ui.setMuteState(video.muted || video.volume === 0);
            this.ui.volume.value = String(video.volume);
        });
        video.addEventListener("click", (event) => this.handleTapToggle(event));
        video.addEventListener("dblclick", (event) => this.handleDoubleTapSeek(event));
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

            if (absX > 50 && absX > absY) {
                const seekAmount = deltaX > 0 ? this.getLongSeek() : -this.getLongSeek();
                this.seekRelative(seekAmount);
                this.ui.showSeekToast(seekAmount > 0 ? `+${Math.abs(seekAmount)}s` : `-${Math.abs(seekAmount)}s`);
                return;
            }

            if (elapsed < 260 && absX < 20 && absY < 20) {
                this.handleTapToggle({ clientX: endX, clientY: endY, type: "touch" });
            }
        }, { passive: true });
    }

    attachKeyboardShortcuts() {
        document.addEventListener("keydown", (event) => {
            const activeTag = document.activeElement?.tagName?.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") return;

            const key = event.key.toLowerCase();
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
                this.toggleMute();
            } else if (key === "f") {
                this.toggleFullscreen();
            } else if (key === "n") {
                this.nextEpisode();
            } else if (key === "p") {
                this.prevEpisode();
            } else if (key === "j") {
                this.seekRelative(-this.getLongSeek());
            } else if (key === "l") {
                this.seekRelative(this.getLongSeek());
            }
        });
    }

    handleAction(action) {
        if (action === "play-pause") this.togglePlayback();
        else if (action === "back-10") this.seekRelative(-this.getShortSeek());
        else if (action === "forward-10") this.seekRelative(this.getShortSeek());
        else if (action === "prev-episode") this.prevEpisode();
        else if (action === "next-episode") this.nextEpisode();
        else if (action === "mute") this.toggleMute();
        else if (action === "pip") this.togglePip();
        else if (action === "fullscreen") this.toggleFullscreen();
        else if (action === "retry") this.playerCore.retry({ autoplay: true, startTime: this.ui.video.currentTime });
        else if (action === "switch-server") this.switchServer(this.playerCore.currentServerIndex + 1);
        else if (action === "play-next-now") this.nextEpisode(true);
        else if (action === "cancel-next") this.clearAutoNext();
        else if (action === "skip-intro") this.skipToIntroEnd();
        else if (action === "skip-outro") this.skipToOutroEnd();
        else if (action === "screenshot") this.captureScreenshot();
    }

    onCoreState(state) {
        this.ui.setBuffering(state === "buffering");
        if (state === "playing") this.ui.setError("");
        if (state === "ended") this.ui.setPlayState(false);
    }

    onCoreError(error) {
        this.ui.setBuffering(false);
        this.ui.setError(error?.message || "Playback error");
        this.ui.setStatus("Error");
        this.syncProgress({ event: "error", error: error?.message || "unknown" });
    }

    onQualityOptions(options, selectedId) {
        this.ui.setQualityOptions(options, selectedId);
        const selected = options.find((option) => option.id === selectedId);
        this.ui.setQualityStatus(`Quality: ${selected?.label || "Auto"}`);
    }

    onAudioTracks(tracks, selectedId) {
        this.ui.setAudioOptions(tracks, selectedId);
        const selected = tracks.find((track) => track.id === selectedId) || tracks[0];
        this.ui.setAudioStatus(`Audio: ${selected?.label || "Default"}`);
    }

    handleTapToggle(event) {
        const rect = this.ui.video.getBoundingClientRect();
        const ratioX = (event.clientX - rect.left) / rect.width;
        const side = ratioX < 0.35 ? "left" : ratioX > 0.65 ? "right" : "center";

        const now = Date.now();
        if (this.lastTap.side === side && now - this.lastTap.ts < 280 && side !== "center") {
            this.seekRelative(side === "left" ? -this.getShortSeek() : this.getShortSeek());
            this.ui.showSeekToast(side === "left" ? `-${this.getShortSeek()}s` : `+${this.getShortSeek()}s`);
            this.lastTap = { side: "", ts: 0 };
            return;
        }

        this.lastTap = { side, ts: now };
        if (side === "center") {
            this.togglePlayback();
        }
    }

    handleDoubleTapSeek(event) {
        const rect = this.ui.video.getBoundingClientRect();
        const ratioX = (event.clientX - rect.left) / rect.width;
        if (ratioX < 0.5) {
            this.seekRelative(-this.getShortSeek());
            this.ui.showSeekToast(`-${this.getShortSeek()}s`);
        } else {
            this.seekRelative(this.getShortSeek());
            this.ui.showSeekToast(`+${this.getShortSeek()}s`);
        }
    }

    seekPercent(percent) {
        if (!Number.isFinite(this.ui.video.duration) || this.ui.video.duration <= 0) return;
        this.ui.video.currentTime = (percent / 100) * this.ui.video.duration;
    }

    handlePreviewHover(ratio, leftPx) {
        const duration = Number.isFinite(this.ui.video.duration) ? this.ui.video.duration : 0;
        const previewTime = duration * ratio;
        const thumbs = this.currentEpisode?.config?.timeline_thumbnails || [];
        let thumbnail = "";
        if (thumbs.length) {
            const chosen = thumbs.reduce((best, current) => {
                if (current.time <= previewTime && current.time > (best?.time ?? -1)) return current;
                return best;
            }, null);
            thumbnail = chosen?.src || "";
        }

        this.ui.showPreview({
            left: leftPx,
            timeLabel: this.ui.formatTime(previewTime),
            thumbnail
        });
    }

    setVolume(volume) {
        this.ui.video.volume = Math.max(0, Math.min(1, volume));
        this.ui.video.muted = this.ui.video.volume === 0;
    }

    setSpeed(speed) {
        this.ui.video.playbackRate = Math.max(0.25, Math.min(3, speed));
    }

    toggleMute() {
        this.ui.video.muted = !this.ui.video.muted;
        if (!this.ui.video.muted && this.ui.video.volume === 0) {
            this.ui.video.volume = 1;
        }
        this.ui.setMuteState(this.ui.video.muted || this.ui.video.volume === 0);
    }

    async togglePlayback() {
        if (!this.ui.video.src) return;
        if (this.ui.video.paused) {
            try {
                await this.ui.video.play();
            } catch (error) {
                console.debug("Autoplay blocked:", error);
            }
        } else {
            this.ui.video.pause();
        }
    }

    seekRelative(seconds) {
        if (!Number.isFinite(this.ui.video.duration)) return;
        const nextTime = Math.min(
            this.ui.video.duration,
            Math.max(0, this.ui.video.currentTime + seconds)
        );
        this.ui.video.currentTime = nextTime;
    }

    skipToIntroEnd() {
        const introEnd = Number(this.currentEpisode?.config?.intro_end || 0);
        if (introEnd > 0) {
            this.ui.video.currentTime = introEnd;
            this.ui.showSeekToast("Skipped Opening");
        }
    }

    skipToOutroEnd() {
        const outroEnd = Number(this.currentEpisode?.config?.outro_end || 0);
        if (outroEnd > 0) {
            this.ui.video.currentTime = outroEnd;
            this.ui.showSeekToast("Skipped Ending");
        }
    }

    updateSkipButtons(currentTime) {
        const cfg = this.currentEpisode?.config || {};
        const introVisible = cfg.intro_end > cfg.intro_start && currentTime >= cfg.intro_start && currentTime < cfg.intro_end;
        const outroVisible = cfg.outro_end > cfg.outro_start && currentTime >= cfg.outro_start && currentTime < cfg.outro_end;
        this.ui.showSkipIntro(introVisible);
        this.ui.showSkipOutro(outroVisible);
    }

    async switchServer(index) {
        const total = this.currentEpisode?.config?.video_sources?.length || 0;
        if (!total) return;
        const normalized = ((index % total) + total) % total;
        const currentTime = this.ui.video.currentTime || 0;
        const autoplay = !this.ui.video.paused;
        const switched = await this.playerCore.switchServer(normalized, { startTime: currentTime, autoplay });
        if (switched) {
            const server = this.currentEpisode.config.video_sources[normalized];
            this.ui.setServerOptions(this.currentEpisode.config.video_sources, String(normalized));
            this.ui.setServerChip(server.label || `Server ${normalized + 1}`);
        }
    }

    prevEpisode() {
        this.loadEpisode(Math.max(0, this.currentEpisodeIndex - 1), true);
    }

    nextEpisode(force = false) {
        const nextIndex = this.currentEpisodeIndex + 1;
        if (nextIndex >= this.config.episodes.length) return;
        if (!force && this.autoNextTimer) return;
        this.clearAutoNext();
        this.loadEpisode(nextIndex, true);
    }

    startAutoNextCountdown() {
        const nextIndex = this.currentEpisodeIndex + 1;
        if (nextIndex >= this.config.episodes.length) return;
        this.clearAutoNext();
        this.autoNextRemaining = Number(this.config.auto_next_seconds || 8);
        const nextTitle = this.config.episodes[nextIndex]?.metadata?.title || `Episode ${nextIndex + 1}`;
        this.ui.showNextCountdown(this.autoNextRemaining, nextTitle);
        this.autoNextTimer = setInterval(() => {
            this.autoNextRemaining -= 1;
            this.ui.showNextCountdown(this.autoNextRemaining, nextTitle);
            if (this.autoNextRemaining <= 0) {
                this.nextEpisode(true);
            }
        }, 1000);
    }

    clearAutoNext() {
        if (this.autoNextTimer) {
            clearInterval(this.autoNextTimer);
            this.autoNextTimer = null;
        }
        this.ui?.hideNextCountdown();
    }

    async togglePip() {
        if (!document.pictureInPictureEnabled) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await this.ui.video.requestPictureInPicture();
            }
        } catch (error) {
            console.debug("PiP unavailable:", error);
        }
    }

    async toggleFullscreen() {
        const target = this.ui.videoWrap;
        if (!document.fullscreenElement) {
            await target.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    }

    captureScreenshot() {
        if (this.ui.video.readyState < 2) return;
        const canvas = document.createElement("canvas");
        canvas.width = this.ui.video.videoWidth;
        canvas.height = this.ui.video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(this.ui.video, 0, 0, canvas.width, canvas.height);
        const link = document.createElement("a");
        const episodeName = this.currentEpisode?.id || "episode";
        link.href = canvas.toDataURL("image/png");
        link.download = `${episodeName.replace(/[^\w.\-]+/g, "_")}-${Math.floor(this.ui.video.currentTime)}s.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
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

    getLongSeek() {
        return Number(this.config.seek_long_seconds || 30);
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
