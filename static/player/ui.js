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
    volume: icon("M3 9h4l5-4v14l-5-4H3zM16 8a5 5 0 010 8"),
    mute: icon("M3 9h4l5-4v14l-5-4H3zM16 9l5 6M21 9l-5 6"),
    pip: icon("M3 5h18v14H3zM13 13h7v5h-7z"),
    fullscreen: icon("M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"),
    screenshot: icon("M4 7h4l2-3h4l2 3h4v12H4zM12 17a4 4 0 100-8 4 4 0 000 8"),
    subtitle: icon("M4 6h16v12H4zM7 11h4M7 15h10")
};

export class PlayerUI {
    constructor(root, handlers = {}) {
        this.root = root;
        this.handlers = handlers;
        this.hideTimer = null;
        this.seekToastTimer = null;
        this.nextCountdownTimer = null;
        this.render();
        this.bindEvents();
    }

    render() {
        this.root.innerHTML = `
            <div class="ap-shell">
                <div class="ap-main">
                    <div class="ap-video-wrap" tabindex="0">
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

                        <div class="ap-next-overlay ap-hidden">
                            <div class="ap-next-title">Up next episode</div>
                            <div class="ap-next-countdown">Starting in 8s</div>
                            <div class="ap-group">
                                <button class="ap-btn" data-action="play-next-now">Play now</button>
                                <button class="ap-btn" data-action="cancel-next">Cancel</button>
                            </div>
                        </div>

                        <button class="ap-skip ap-skip-intro ap-hidden" data-action="skip-intro">Skip Opening</button>
                        <button class="ap-skip ap-skip-outro ap-hidden" data-action="skip-outro">Skip Ending</button>
                        <div class="ap-seek-toast">+10s</div>

                        <div class="ap-overlay-controls">
                            <div class="ap-topbar">
                                <div class="ap-episode-meta">
                                    <div class="ap-episode-title">Loading...</div>
                                    <div class="ap-episode-synopsis"></div>
                                </div>
                                <div class="ap-chip-row">
                                    <span class="ap-chip" data-chip="softsub">Hard Subs</span>
                                    <span class="ap-chip" data-chip="server">Server A</span>
                                </div>
                            </div>

                            <div class="ap-bottom-controls">
                                <div class="ap-progress-wrap">
                                    <input class="ap-progress" type="range" min="0" max="100" value="0" step="0.05">
                                    <div class="ap-preview-pop">
                                        <img class="ap-preview-thumb ap-hidden" alt="Preview">
                                        <div class="ap-preview-time">00:00</div>
                                    </div>
                                </div>

                                <div class="ap-control-row">
                                    <div class="ap-group">
                                        <button class="ap-btn" data-action="play-pause" title="Play/Pause">${Icons.play}</button>
                                        <button class="ap-btn" data-action="back-10" title="Back 10s">${Icons.back10}</button>
                                        <button class="ap-btn" data-action="forward-10" title="Forward 10s">${Icons.forward10}</button>
                                        <button class="ap-btn" data-action="prev-episode" title="Previous">${Icons.prev}</button>
                                        <button class="ap-btn" data-action="next-episode" title="Next">${Icons.next}</button>
                                        <button class="ap-btn" data-action="mute" title="Mute">${Icons.volume}</button>
                                        <input class="ap-volume" type="range" min="0" max="1" step="0.02" value="1">
                                        <button class="ap-btn" data-action="subtitle-settings" title="Subtitle style">${Icons.subtitle}</button>
                                        <button class="ap-btn" data-action="screenshot" title="Screenshot">${Icons.screenshot}</button>
                                    </div>

                                    <div class="ap-group">
                                        <select class="ap-select ap-server-select" title="Servers"></select>
                                        <select class="ap-select ap-quality-select" title="Quality"></select>
                                        <select class="ap-select ap-audio-select" title="Audio"></select>
                                        <select class="ap-select ap-subtitle-select" title="Subtitles"></select>
                                        <select class="ap-speed" title="Playback speed">
                                            <option value="0.25">0.25x</option>
                                            <option value="0.5">0.5x</option>
                                            <option value="0.75">0.75x</option>
                                            <option value="1" selected>1x</option>
                                            <option value="1.25">1.25x</option>
                                            <option value="1.5">1.5x</option>
                                            <option value="1.75">1.75x</option>
                                            <option value="2">2x</option>
                                            <option value="2.5">2.5x</option>
                                            <option value="3">3x</option>
                                        </select>
                                        <button class="ap-btn" data-action="pip" title="Picture in Picture">${Icons.pip}</button>
                                        <button class="ap-btn" data-action="fullscreen" title="Fullscreen">${Icons.fullscreen}</button>
                                        <div class="ap-time"><span data-bind="time">00:00 / 00:00</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="ap-subtitle-panel ap-hidden">
                            <label>Font Size</label>
                            <input class="ap-sub-size" type="range" min="12" max="34" value="18">
                            <label>Text Color</label>
                            <input class="ap-sub-color" type="color" value="#ffffff">
                            <label>Background Color</label>
                            <input class="ap-sub-bg" type="color" value="#000000">
                            <label>Background Opacity</label>
                            <input class="ap-sub-opacity" type="range" min="0" max="1" step="0.05" value="0.62">
                        </div>
                    </div>

                    <div class="ap-status-row">
                        <span class="ap-pill" data-bind="status">Idle</span>
                        <span class="ap-pill" data-bind="quality-status">Quality: Auto</span>
                        <span class="ap-pill" data-bind="audio-status">Audio: Default</span>
                    </div>
                </div>

                <aside class="ap-sidebar">
                    <div class="ap-sidebar-title">Episodes</div>
                    <div class="ap-episode-list"></div>
                </aside>
            </div>
        `;

        this.video = this.root.querySelector(".ap-video");
        this.videoWrap = this.root.querySelector(".ap-video-wrap");
        this.progress = this.root.querySelector(".ap-progress");
        this.previewPop = this.root.querySelector(".ap-preview-pop");
        this.previewThumb = this.root.querySelector(".ap-preview-thumb");
        this.previewTime = this.root.querySelector(".ap-preview-time");
        this.volume = this.root.querySelector(".ap-volume");
        this.speed = this.root.querySelector(".ap-speed");
        this.serverSelect = this.root.querySelector(".ap-server-select");
        this.qualitySelect = this.root.querySelector(".ap-quality-select");
        this.audioSelect = this.root.querySelector(".ap-audio-select");
        this.subtitleSelect = this.root.querySelector(".ap-subtitle-select");
        this.subtitlePanel = this.root.querySelector(".ap-subtitle-panel");
        this.subtitleSize = this.root.querySelector(".ap-sub-size");
        this.subtitleColor = this.root.querySelector(".ap-sub-color");
        this.subtitleBg = this.root.querySelector(".ap-sub-bg");
        this.subtitleOpacity = this.root.querySelector(".ap-sub-opacity");
        this.playButton = this.root.querySelector('[data-action="play-pause"]');
        this.muteButton = this.root.querySelector('[data-action="mute"]');
        this.timeLabel = this.root.querySelector('[data-bind="time"]');
        this.statusLabel = this.root.querySelector('[data-bind="status"]');
        this.qualityStatus = this.root.querySelector('[data-bind="quality-status"]');
        this.audioStatus = this.root.querySelector('[data-bind="audio-status"]');
        this.softSubChip = this.root.querySelector('[data-chip="softsub"]');
        this.serverChip = this.root.querySelector('[data-chip="server"]');
        this.loadingOverlay = this.root.querySelector(".ap-loading");
        this.errorOverlay = this.root.querySelector(".ap-error");
        this.errorMessage = this.root.querySelector(".ap-error-msg");
        this.nextOverlay = this.root.querySelector(".ap-next-overlay");
        this.nextCountdown = this.root.querySelector(".ap-next-countdown");
        this.seekToast = this.root.querySelector(".ap-seek-toast");
        this.skipIntroButton = this.root.querySelector('[data-action="skip-intro"]');
        this.skipOutroButton = this.root.querySelector('[data-action="skip-outro"]');
        this.episodeList = this.root.querySelector(".ap-episode-list");
        this.overlayControls = this.root.querySelector(".ap-overlay-controls");
        this.titleNode = this.root.querySelector(".ap-episode-title");
        this.synopsisNode = this.root.querySelector(".ap-episode-synopsis");
    }

    bindEvents() {
        this.root.querySelectorAll("[data-action]").forEach((button) => {
            button.addEventListener("click", (event) => {
                const action = event.currentTarget.getAttribute("data-action");
                if (action === "subtitle-settings") {
                    this.subtitlePanel.classList.toggle("ap-hidden");
                    return;
                }
                if (typeof this.handlers.onAction === "function") {
                    this.handlers.onAction(action);
                }
            });
        });

        this.progress.addEventListener("input", () => {
            if (typeof this.handlers.onSeekPercent === "function") {
                this.handlers.onSeekPercent(Number(this.progress.value));
            }
        });

        this.progress.addEventListener("mousemove", (event) => {
            if (typeof this.handlers.onPreviewHover !== "function") return;
            const rect = this.progress.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            this.handlers.onPreviewHover(ratio, event.clientX - rect.left);
        });
        this.progress.addEventListener("mouseleave", () => this.hidePreview());

        this.volume.addEventListener("input", () => {
            if (typeof this.handlers.onVolumeChange === "function") {
                this.handlers.onVolumeChange(Number(this.volume.value));
            }
        });

        this.speed.addEventListener("change", () => {
            if (typeof this.handlers.onSpeedChange === "function") {
                this.handlers.onSpeedChange(Number(this.speed.value));
            }
        });

        this.serverSelect.addEventListener("change", () => {
            if (typeof this.handlers.onServerChange === "function") {
                this.handlers.onServerChange(this.serverSelect.value);
            }
        });
        this.qualitySelect.addEventListener("change", () => {
            if (typeof this.handlers.onQualityChange === "function") {
                this.handlers.onQualityChange(this.qualitySelect.value);
            }
        });
        this.audioSelect.addEventListener("change", () => {
            if (typeof this.handlers.onAudioTrackChange === "function") {
                this.handlers.onAudioTrackChange(this.audioSelect.value);
            }
        });
        this.subtitleSelect.addEventListener("change", () => {
            if (typeof this.handlers.onSubtitleTrackChange === "function") {
                this.handlers.onSubtitleTrackChange(this.subtitleSelect.value);
            }
        });

        const subtitleStyleDispatch = () => {
            if (typeof this.handlers.onSubtitleStyleChange !== "function") return;
            this.handlers.onSubtitleStyleChange({
                size: Number(this.subtitleSize.value),
                color: this.subtitleColor.value,
                background: this.subtitleBg.value,
                opacity: Number(this.subtitleOpacity.value)
            });
        };
        [this.subtitleSize, this.subtitleColor, this.subtitleBg, this.subtitleOpacity].forEach((node) => {
            node.addEventListener("input", subtitleStyleDispatch);
        });

        this.videoWrap.addEventListener("mousemove", () => this.pokeControls());
        this.videoWrap.addEventListener("touchstart", () => this.pokeControls(), { passive: true });
        this.videoWrap.addEventListener("mouseleave", () => this.hideControlsSoon(1200));
    }

    pokeControls() {
        this.overlayControls.classList.remove("ap-hidden");
        this.hideControlsSoon();
    }

    hideControlsSoon(timeout = 2400) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            if (!this.video.paused) {
                this.overlayControls.classList.add("ap-hidden");
            }
        }, timeout);
    }

    updateTime(current, duration) {
        const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
        const safeCurrent = Number.isFinite(current) ? current : 0;
        if (safeDuration > 0) {
            this.progress.value = String((safeCurrent / safeDuration) * 100);
            this.progress.style.setProperty("--fill", `${(safeCurrent / safeDuration) * 100}%`);
        }
        this.timeLabel.textContent = `${this.formatTime(safeCurrent)} / ${this.formatTime(safeDuration)}`;
    }

    setPlayState(playing) {
        this.playButton.innerHTML = playing ? Icons.pause : Icons.play;
    }

    setMuteState(muted) {
        this.muteButton.innerHTML = muted ? Icons.mute : Icons.volume;
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

    setStatus(text) {
        this.statusLabel.textContent = text;
    }

    setQualityStatus(text) {
        this.qualityStatus.textContent = text;
    }

    setAudioStatus(text) {
        this.audioStatus.textContent = text;
    }

    setSoftSubtitleStatus(hasSoftSubs) {
        this.softSubChip.textContent = hasSoftSubs ? "Soft Subs" : "Hard/No Subs";
    }

    setServerChip(text) {
        this.serverChip.textContent = text;
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
        selectNode.innerHTML = options.map((option) => `
            <option value="${option.id}">${option.label}</option>
        `).join("");
        const targetValue = selectedId ?? options[0]?.id ?? "";
        selectNode.value = String(targetValue);
    }

    setEpisodeMeta(title, synopsis) {
        this.titleNode.textContent = title || "Untitled episode";
        this.synopsisNode.textContent = synopsis || "";
    }

    setEpisodes(episodes, currentIndex) {
        this.episodeList.innerHTML = episodes.map((episode, index) => `
            <button class="ap-episode-item ${index === currentIndex ? "ap-active" : ""}" data-episode-index="${index}">
                <img class="ap-episode-thumb" src="${episode.thumbnail || "/static/player/episode-placeholder.svg"}" alt="Episode thumbnail">
                <div>
                    <div class="ap-episode-name">EP ${episode.episode_number}: ${episode.metadata?.title || episode.filename}</div>
                    <div class="ap-episode-desc">${episode.metadata?.synopsis || ""}</div>
                </div>
            </button>
        `).join("");

        this.episodeList.querySelectorAll("[data-episode-index]").forEach((node) => {
            node.addEventListener("click", () => {
                if (typeof this.handlers.onEpisodeSelect === "function") {
                    this.handlers.onEpisodeSelect(Number(node.getAttribute("data-episode-index")));
                }
            });
        });
    }

    showSeekToast(label) {
        this.seekToast.textContent = label;
        this.seekToast.classList.remove("ap-visible");
        void this.seekToast.offsetWidth;
        this.seekToast.classList.add("ap-visible");
        clearTimeout(this.seekToastTimer);
        this.seekToastTimer = setTimeout(() => {
            this.seekToast.classList.remove("ap-visible");
        }, 500);
    }

    showSkipIntro(show) {
        this.skipIntroButton.classList.toggle("ap-hidden", !show);
    }

    showSkipOutro(show) {
        this.skipOutroButton.classList.toggle("ap-hidden", !show);
    }

    showPreview({ left, timeLabel, thumbnail }) {
        this.previewPop.style.left = `${left}px`;
        this.previewTime.textContent = timeLabel;
        if (thumbnail) {
            this.previewThumb.src = thumbnail;
            this.previewThumb.classList.remove("ap-hidden");
        } else {
            this.previewThumb.classList.add("ap-hidden");
        }
        this.previewPop.classList.add("ap-visible");
    }

    hidePreview() {
        this.previewPop.classList.remove("ap-visible");
    }

    showNextCountdown(seconds, nextTitle) {
        this.nextOverlay.classList.remove("ap-hidden");
        this.nextCountdown.textContent = `Playing ${nextTitle || "next episode"} in ${seconds}s`;
    }

    hideNextCountdown() {
        this.nextOverlay.classList.add("ap-hidden");
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
