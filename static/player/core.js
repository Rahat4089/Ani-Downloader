export class PlayerCore {
    constructor(videoElement, callbacks = {}) {
        this.video = videoElement;
        this.callbacks = callbacks;
        this.hls = null;
        this.dash = null;
        this.currentSource = null;
        this.sources = [];
        this.currentServerIndex = 0;
        this.engineType = "native";
        this.qualityOptions = [{ id: "auto", label: "Auto" }];
        this.currentQualityId = "auto";
        this.audioTracks = [];
        this.currentAudioTrackId = "default";
        this._bindNativeEvents();
    }

    _bindNativeEvents() {
        this.video.addEventListener("waiting", () => this._emitState("buffering"));
        this.video.addEventListener("playing", () => this._emitState("playing"));
        this.video.addEventListener("pause", () => this._emitState("paused"));
        this.video.addEventListener("ended", () => this._emitState("ended"));
        this.video.addEventListener("error", () => {
            const message = this.video.error ? `Media error code ${this.video.error.code}` : "Unknown media error";
            this._emitError(message);
        });
    }

    _emitState(state) {
        if (typeof this.callbacks.onState === "function") {
            this.callbacks.onState(state);
        }
    }

    _emitError(message, details = null) {
        if (typeof this.callbacks.onError === "function") {
            this.callbacks.onError({ message, details });
        }
    }

    _emitQualityOptions() {
        if (typeof this.callbacks.onQualityOptions === "function") {
            this.callbacks.onQualityOptions(this.qualityOptions, this.currentQualityId);
        }
    }

    _emitAudioTracks() {
        if (typeof this.callbacks.onAudioTracks === "function") {
            this.callbacks.onAudioTracks(this.audioTracks, this.currentAudioTrackId);
        }
    }

    _applyToken(url, source) {
        if (!source || !source.token) return url;
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}token=${encodeURIComponent(source.token)}`;
    }

    _clearEngine() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.dash) {
            this.dash.reset();
            this.dash = null;
        }
    }

    destroy() {
        this._clearEngine();
        this.video.removeAttribute("src");
        this.video.load();
    }

    async loadSources(videoSources, options = {}) {
        this.sources = Array.isArray(videoSources) ? videoSources : [];
        this.currentServerIndex = 0;
        return this.switchServer(0, options);
    }

    async retry(options = {}) {
        return this.switchServer(this.currentServerIndex, options);
    }

    async switchServer(index, options = {}) {
        if (!this.sources.length) {
            this._emitError("No video sources available");
            return false;
        }

        const targetIndex = Math.max(0, Math.min(index, this.sources.length - 1));
        this.currentServerIndex = targetIndex;
        this.currentSource = this.sources[targetIndex];
        const source = this.currentSource;
        const targetUrl = this._applyToken(source.url, source);
        const startTime = Number.isFinite(options.startTime) ? options.startTime : 0;
        const shouldAutoplay = Boolean(options.autoplay);

        this._clearEngine();
        this.video.pause();
        this.video.removeAttribute("src");

        try {
            if (source.type === "hls") {
                await this._loadHls(targetUrl, { startTime, autoplay: shouldAutoplay, source });
            } else if (source.type === "dash") {
                await this._loadDash(targetUrl, { startTime, autoplay: shouldAutoplay, source });
            } else {
                await this._loadNative(targetUrl, { startTime, autoplay: shouldAutoplay });
            }
            return true;
        } catch (error) {
            this._emitError(error.message || "Failed to load source", error);
            return false;
        }
    }

    async _loadNative(url, options) {
        this.engineType = "native";
        this.qualityOptions = [{ id: "auto", label: "Auto" }];
        this.currentQualityId = "auto";
        this.audioTracks = [{ id: "default", label: "Default", language: "und" }];
        this.currentAudioTrackId = "default";
        this._emitQualityOptions();
        this._emitAudioTracks();

        this.video.src = url;
        this.video.load();
        await this._waitForMetadata();
        if (options.startTime > 0 && options.startTime < this.video.duration - 5) {
            this.video.currentTime = options.startTime;
        }
        if (options.autoplay) {
            await this.video.play();
        }
    }

    async _loadHls(url, options) {
        if (!(window.Hls && window.Hls.isSupported())) {
            if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
                return this._loadNative(url, options);
            }
            throw new Error("HLS playback is not supported in this browser");
        }

        this.engineType = "hls";
        this.hls = new window.Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            maxBufferLength: 30
        });

        this.hls.on(window.Hls.Events.ERROR, (_, data) => {
            if (data?.fatal) {
                this._emitError(data.details || "HLS fatal error", data);
            }
        });

        this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            const levelMap = new Map();
            this.hls.levels.forEach((level, idx) => {
                const key = level.height || `level-${idx}`;
                if (!levelMap.has(key)) {
                    levelMap.set(key, { id: String(idx), label: level.height ? `${level.height}p` : `Level ${idx + 1}` });
                }
            });
            const qualityLevels = Array.from(levelMap.values()).sort((a, b) => {
                const aNum = Number.parseInt(a.label, 10) || 0;
                const bNum = Number.parseInt(b.label, 10) || 0;
                return bNum - aNum;
            });
            this.qualityOptions = [{ id: "auto", label: "Auto" }, ...qualityLevels];
            this.currentQualityId = "auto";
            this._emitQualityOptions();

            this.audioTracks = this.hls.audioTracks.map((track, idx) => ({
                id: String(idx),
                label: track.name || track.lang || `Track ${idx + 1}`,
                language: track.lang || "und"
            }));
            if (!this.audioTracks.length) {
                this.audioTracks = [{ id: "default", label: "Default", language: "und" }];
            }
            this.currentAudioTrackId = this.audioTracks[0].id;
            this._emitAudioTracks();
        });

        this.hls.on(window.Hls.Events.LEVEL_SWITCHED, (_, data) => {
            this.currentQualityId = data.level >= 0 ? String(data.level) : "auto";
            this._emitQualityOptions();
        });

        this.hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
            this.currentAudioTrackId = String(data.id);
            this._emitAudioTracks();
        });

        this.hls.attachMedia(this.video);
        this.hls.loadSource(url);

        await this._waitForMetadata();
        if (options.startTime > 0 && options.startTime < this.video.duration - 5) {
            this.video.currentTime = options.startTime;
        }
        if (options.autoplay) {
            await this.video.play();
        }
    }

    async _loadDash(url, options) {
        if (!(window.dashjs && window.dashjs.MediaPlayer)) {
            throw new Error("DASH playback is not supported in this browser");
        }

        this.engineType = "dash";
        this.dash = window.dashjs.MediaPlayer().create();
        this.dash.updateSettings({
            streaming: {
                lowLatencyEnabled: true,
                abr: { autoSwitchBitrate: { video: true, audio: true } }
            }
        });

        if (options.source?.drm?.widevine_license_url) {
            this.dash.setProtectionData({
                "com.widevine.alpha": {
                    serverURL: options.source.drm.widevine_license_url
                }
            });
        }

        this.dash.on(window.dashjs.MediaPlayer.events.ERROR, (event) => {
            this._emitError("DASH playback error", event);
        });

        this.dash.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
            const qualityInfo = this.dash.getBitrateInfoListFor("video") || [];
            this.qualityOptions = [{ id: "auto", label: "Auto" }, ...qualityInfo.map((item) => ({
                id: String(item.qualityIndex),
                label: item.height ? `${item.height}p` : `${Math.round(item.bitrate / 1000)} kbps`
            }))];
            this.currentQualityId = "auto";
            this._emitQualityOptions();

            const audioTracks = this.dash.getTracksFor("audio") || [];
            this.audioTracks = audioTracks.map((track, idx) => ({
                id: String(idx),
                label: track.labels?.[0]?.text || track.lang || `Audio ${idx + 1}`,
                language: track.lang || "und"
            }));
            if (!this.audioTracks.length) {
                this.audioTracks = [{ id: "default", label: "Default", language: "und" }];
            }
            this.currentAudioTrackId = this.audioTracks[0].id;
            this._emitAudioTracks();
        });

        this.dash.initialize(this.video, url, false);
        await this._waitForMetadata();
        if (options.startTime > 0 && options.startTime < this.video.duration - 5) {
            this.video.currentTime = options.startTime;
        }
        if (options.autoplay) {
            await this.video.play();
        }
    }

    async _waitForMetadata() {
        if (this.video.readyState >= 1) return;
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                this.video.removeEventListener("loadedmetadata", onLoaded);
                this.video.removeEventListener("error", onError);
            };
            const onLoaded = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error("Unable to read media metadata"));
            };
            this.video.addEventListener("loadedmetadata", onLoaded, { once: true });
            this.video.addEventListener("error", onError, { once: true });
        });
    }

    setQuality(qualityId) {
        if (this.engineType === "hls" && this.hls) {
            if (qualityId === "auto") {
                this.hls.currentLevel = -1;
            } else {
                this.hls.currentLevel = Number.parseInt(qualityId, 10);
            }
            this.currentQualityId = qualityId;
            this._emitQualityOptions();
            return;
        }

        if (this.engineType === "dash" && this.dash) {
            if (qualityId === "auto") {
                this.dash.setAutoSwitchQualityFor("video", true);
            } else {
                this.dash.setAutoSwitchQualityFor("video", false);
                this.dash.setQualityFor("video", Number.parseInt(qualityId, 10), true);
            }
            this.currentQualityId = qualityId;
            this._emitQualityOptions();
        }
    }

    setAudioTrack(trackId) {
        if (this.engineType === "hls" && this.hls && trackId !== "default") {
            const idx = Number.parseInt(trackId, 10);
            if (Number.isFinite(idx)) {
                this.hls.audioTrack = idx;
                this.currentAudioTrackId = trackId;
                this._emitAudioTracks();
            }
            return;
        }

        if (this.engineType === "dash" && this.dash && trackId !== "default") {
            const idx = Number.parseInt(trackId, 10);
            const tracks = this.dash.getTracksFor("audio") || [];
            if (tracks[idx]) {
                this.dash.setCurrentTrack(tracks[idx]);
                this.currentAudioTrackId = trackId;
                this._emitAudioTracks();
            }
        }
    }

    preloadUrl(url) {
        if (!url) return;
        const preload = document.createElement("link");
        preload.rel = "preload";
        preload.as = "video";
        preload.href = url;
        document.head.appendChild(preload);
    }
}
