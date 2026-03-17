function icon(pathD) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${pathD}"></path></svg>`;
}

const Icons = {
    play: icon("M8 5l11 7-11 7V5z"),
    pause: icon("M8 5h3v14H8zM13 5h3v14h-3z"),
    back10: icon("M12 5l-7 7 7 7M19 5v14"),
    forward10: icon("M12 5l7 7-7 7M5 5v14"),
    prev: icon("M19 5v14M15 12L7 5v14l8-7z"),
    next: icon("M5 5v14M9 12l8-7v14l-8-7z"),
    fullscreen: icon("M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"),
    dots: icon("M6 12h.01M12 12h.01M18 12h.01"),
    lock: icon("M7 11V8a5 5 0 0110 0v3M6 11h12v10H6z"),
    unlock: icon("M7 11V8a5 5 0 019.4-2.3"),
    playPulse: icon("M8 5l11 7-11 7V5z"),
    pausePulse: icon("M8 5h3v14H8zM13 5h3v14h-3z")
};

export class PlayerUI {
    constructor(root, handlers = {}) {
        this.root = root;
        this.handlers = handlers;
        this.hideTimer = null;
        this.seekToastTimer = null;
        this.render();
        this.bindEvents();
    }

    render() {
        this.root.innerHTML = `
            <div class="ap-shell ap-clean-shell">
                <div class="ap-main ap-main-clean">
                    <div class="ap-video-wrap ap-video-wrap-clean" tabindex="0">
                        <video class="ap-video" playsinline preload="metadata" disablePictureInPicture="false"></video>

                        <div class="ap-loading ap-hidden">
                            <div class="ap-spinner"></div>
                        </div>

                        <div class="ap-error ap-hidden">
                            <div class="ap-error-msg">Playback failed.</div>
                            <div class="ap-group">
                                <button class="ap-btn" data-action="retry">Retry</button>
                                <button class="ap-btn" data-action="switch-server">Switch Server</button>
                            </div>
                        </div>

                        <div class="ap-seek-toast">+10s</div>
                        <div class="ap-play-pulse"></div>

                        <div class="ap-top-actions">
                            <button class="ap-btn ap-lock-btn" data-action="toggle-lock" title="Lock">${Icons.lock}</button>
                            <button class="ap-btn ap-more-btn ap-hidden" data-action="toggle-options" title="More">${Icons.dots}</button>
                        </div>

                        <div class="ap-options-panel ap-hidden">
                            <label>Speed</label>
                            <select class="ap-speed">
                                <option value="0.25">0.25x</option>
                                <option value="0.5">0.5x</option>
                                <option value="0.75">0.75x</option>
                                <option value="1" selected>1x</option>
                                <option value="1.25">1.25x</option>
                                <option value="1.5">1.5x</option>
                                <option value="2">2x</option>
                                <option value="2.5">2.5x</option>
                                <option value="3">3x</option>
                            </select>

                            <label>Volume</label>
                            <input class="ap-volume" type="range" min="0" max="1" step="0.02" value="1">

                            <label>Server</label>
                            <select class="ap-select ap-server-select"></select>

                            <label>Quality</label>
                            <select class="ap-select ap-quality-select"></select>

                            <label>Audio</label>
                            <select class="ap-select ap-audio-select"></select>

                            <label>Subtitles</label>
                            <select class="ap-select ap-subtitle-select"></select>
                        </div>

                        <div class="ap-bottom-controls ap-bottom-controls-clean ap-hidden">
                            <div class="ap-progress-wrap">
                                <input class="ap-progress" type="range" min="0" max="100" value="0" step="0.05">
                            </div>
                            <div class="ap-control-center">
                                <button class="ap-btn" data-action="prev-episode" title="Previous">${Icons.prev}</button>
                                <button class="ap-btn" data-action="back-10" title="-10s">${Icons.back10}</button>
                                <button class="ap-btn ap-play-btn" data-action="play-pause" title="Play/Pause">${Icons.play}</button>
                                <button class="ap-btn" data-action="forward-10" title="+10s">${Icons.forward10}</button>
                                <button class="ap-btn" data-action="next-episode" title="Next">${Icons.next}</button>
                                <button class="ap-btn" data-action="fullscreen" title="Fullscreen">${Icons.fullscreen}</button>
                            </div>
                            <div class="ap-time"><span data-bind="time">00:00 / 00:00</span></div>
                        </div>
                    </div>
                </div>

                <aside class="ap-sidebar">
                    <div class="ap-sidebar-title">Episodes</div>
                    <div class="ap-sidebar-actions">
                        <label class="ap-check">
                            <input type="checkbox" class="ap-select-all">
                            <span>Select all</span>
                        </label>
                        <button class="ap-btn ap-episode-bulk-delete" data-action="delete-selected-episodes">Delete Selected</button>
                        <button class="ap-btn ap-series-delete" data-action="delete-series">Delete Series</button>
                    </div>
                    <div class="ap-episode-list"></div>
                </aside>
            </div>
        `;

        this.video = this.root.querySelector(".ap-video");
        this.videoWrap = this.root.querySelector(".ap-video-wrap");
        this.progress = this.root.querySelector(".ap-progress");
        this.speed = this.root.querySelector(".ap-speed");
        this.volume = this.root.querySelector(".ap-volume");
        this.serverSelect = this.root.querySelector(".ap-server-select");
        this.qualitySelect = this.root.querySelector(".ap-quality-select");
        this.audioSelect = this.root.querySelector(".ap-audio-select");
        this.subtitleSelect = this.root.querySelector(".ap-subtitle-select");
        this.playButton = this.root.querySelector('[data-action="play-pause"]');
        this.timeLabel = this.root.querySelector('[data-bind="time"]');
        this.loadingOverlay = this.root.querySelector(".ap-loading");
        this.errorOverlay = this.root.querySelector(".ap-error");
        this.errorMessage = this.root.querySelector(".ap-error-msg");
        this.seekToast = this.root.querySelector(".ap-seek-toast");
        this.playPulse = this.root.querySelector(".ap-play-pulse");
        this.lockButton = this.root.querySelector(".ap-lock-btn");
        this.moreButton = this.root.querySelector(".ap-more-btn");
        this.optionsPanel = this.root.querySelector(".ap-options-panel");
        this.bottomControls = this.root.querySelector(".ap-bottom-controls");
        this.episodeList = this.root.querySelector(".ap-episode-list");
        this.selectAll = this.root.querySelector(".ap-select-all");
        this.locked = false;
    }

    bindEvents() {
        this.root.querySelectorAll("[data-action]").forEach((button) => {
            button.addEventListener("click", (event) => {
                const action = event.currentTarget.getAttribute("data-action");
                if (typeof this.handlers.onAction === "function") {
                    this.handlers.onAction(action);
                }
            });
        });

        this.progress.addEventListener("input", () => {
            this.handlers.onSeekPercent?.(Number(this.progress.value));
        });
        this.volume.addEventListener("input", () => {
            this.handlers.onVolumeChange?.(Number(this.volume.value));
        });
        this.speed.addEventListener("change", () => {
            this.handlers.onSpeedChange?.(Number(this.speed.value));
        });
        this.serverSelect.addEventListener("change", () => {
            this.handlers.onServerChange?.(this.serverSelect.value);
        });
        this.qualitySelect.addEventListener("change", () => {
            this.handlers.onQualityChange?.(this.qualitySelect.value);
        });
        this.audioSelect.addEventListener("change", () => {
            this.handlers.onAudioTrackChange?.(this.audioSelect.value);
        });
        this.subtitleSelect.addEventListener("change", () => {
            this.handlers.onSubtitleTrackChange?.(this.subtitleSelect.value);
        });

        this.selectAll.addEventListener("change", () => {
            this.episodeList.querySelectorAll(".ap-episode-select").forEach((checkbox) => {
                checkbox.checked = this.selectAll.checked;
            });
        });
    }

    revealControls() {
        if (this.locked) return;
        this.bottomControls.classList.remove("ap-hidden");
        this.moreButton.classList.remove("ap-hidden");
        this.hideControlsSoon();
    }

    hideControlsSoon(timeout = 2200) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            if (this.locked || this.isInteractingWithControls()) {
                this.hideControlsSoon(1200);
                return;
            }
            this.bottomControls.classList.add("ap-hidden");
            this.moreButton.classList.add("ap-hidden");
            this.optionsPanel.classList.add("ap-hidden");
        }, Math.max(3000, timeout));
    }

    isInteractingWithControls() {
        const active = document.activeElement;
        if (!active) return false;
        if (this.optionsPanel.contains(active)) return true;
        if (this.bottomControls.contains(active)) return true;
        if (!this.optionsPanel.classList.contains("ap-hidden")) return true;
        return false;
    }

    setLocked(locked) {
        this.locked = locked;
        if (locked) {
            this.bottomControls.classList.add("ap-hidden");
            this.moreButton.classList.add("ap-hidden");
            this.optionsPanel.classList.add("ap-hidden");
            this.lockButton.innerHTML = Icons.unlock;
            this.videoWrap.classList.add("ap-locked");
            this.root.classList.add("ap-screen-locked");
        } else {
            this.lockButton.innerHTML = Icons.lock;
            this.videoWrap.classList.remove("ap-locked");
            this.root.classList.remove("ap-screen-locked");
            this.revealControls();
        }
    }

    toggleOptionsMenu() {
        if (this.locked) return;
        this.optionsPanel.classList.toggle("ap-hidden");
        this.revealControls();
    }

    updateTime(current, duration) {
        const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
        const safeCurrent = Number.isFinite(current) ? current : 0;
        if (safeDuration > 0) {
            const percentage = (safeCurrent / safeDuration) * 100;
            this.progress.value = String(percentage);
            this.progress.style.setProperty("--fill", `${percentage}%`);
        }
        this.timeLabel.textContent = `${this.formatTime(safeCurrent)} / ${this.formatTime(safeDuration)}`;
    }

    setPlayState(playing) {
        this.playButton.innerHTML = playing ? Icons.pause : Icons.play;
    }

    showPlayPulse(playing) {
        this.playPulse.innerHTML = playing ? Icons.playPulse : Icons.pausePulse;
        this.playPulse.classList.remove("ap-visible");
        void this.playPulse.offsetWidth;
        this.playPulse.classList.add("ap-visible");
    }

    setBuffering(show) {
        this.loadingOverlay.classList.toggle("ap-hidden", !show);
    }

    setError(message = "") {
        if (message) {
            this.errorMessage.textContent = message;
            this.errorOverlay.classList.remove("ap-hidden");
            return;
        }
        this.errorOverlay.classList.add("ap-hidden");
    }

    setServerOptions(options, selectedId) {
        this.populateSelect(this.serverSelect, options.map((item, idx) => ({
            id: String(idx),
            label: item.label || `Server ${idx + 1}`
        })), selectedId);
    }

    setQualityOptions(options, selectedId) {
        this.populateSelect(this.qualitySelect, options, selectedId);
    }

    setAudioOptions(options, selectedId) {
        this.populateSelect(this.audioSelect, options, selectedId);
    }

    setSubtitleOptions(options, selectedId) {
        this.populateSelect(this.subtitleSelect, options, selectedId);
    }

    populateSelect(selectNode, options, selectedId) {
        selectNode.innerHTML = options.map((option) => `<option value="${option.id}">${option.label}</option>`).join("");
        selectNode.value = String(selectedId ?? options[0]?.id ?? "");
    }

    setEpisodes(episodes, currentIndex) {
        this.episodeList.innerHTML = episodes.map((episode, index) => `
            <div class="ap-episode-item ${index === currentIndex ? "ap-active" : ""}" data-episode-index="${index}">
                <label class="ap-check">
                    <input type="checkbox" class="ap-episode-select" data-episode-check="${index}">
                </label>
                <img class="ap-episode-thumb" src="${episode.thumbnail || "/static/player/episode-placeholder.svg"}" alt="Episode thumbnail">
                <div class="ap-episode-content">
                    <button class="ap-episode-main" data-episode-play="${index}">
                        <div class="ap-episode-name">EP ${episode.episode_number}: ${episode.metadata?.title || episode.filename}</div>
                        <div class="ap-episode-desc">${episode.metadata?.synopsis || ""}</div>
                        <div class="ap-episode-runtime">Runtime: ${episode.runtime_label || "Unknown"}</div>
                    </button>
                    <div class="ap-episode-item-actions">
                        <a class="ap-btn ap-mini-btn" href="${episode.download_url || "#"}" ${episode.download_url ? "" : "aria-disabled='true'"} download>Download</a>
                        <button class="ap-btn ap-mini-btn" data-episode-delete="${index}">Delete</button>
                    </div>
                </div>
            </div>
        `).join("");

        this.episodeList.querySelectorAll("[data-episode-play]").forEach((node) => {
            node.addEventListener("click", () => this.handlers.onEpisodeSelect?.(Number(node.getAttribute("data-episode-play"))));
        });
        this.episodeList.querySelectorAll("[data-episode-delete]").forEach((node) => {
            node.addEventListener("click", () => this.handlers.onDeleteEpisode?.(Number(node.getAttribute("data-episode-delete"))));
        });
    }

    getSelectedEpisodeIndexes() {
        return Array.from(this.episodeList.querySelectorAll(".ap-episode-select"))
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => Number.parseInt(checkbox.getAttribute("data-episode-check"), 10))
            .filter((value) => Number.isFinite(value));
    }

    clearEpisodeSelection() {
        this.selectAll.checked = false;
        this.episodeList.querySelectorAll(".ap-episode-select").forEach((checkbox) => {
            checkbox.checked = false;
        });
    }

    showSeekToast(label) {
        this.seekToast.textContent = label;
        this.seekToast.classList.remove("ap-visible");
        void this.seekToast.offsetWidth;
        this.seekToast.classList.add("ap-visible");
        clearTimeout(this.seekToastTimer);
        this.seekToastTimer = setTimeout(() => this.seekToast.classList.remove("ap-visible"), 500);
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
        const total = Math.floor(seconds);
        const hours = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        if (hours > 0) return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
}
