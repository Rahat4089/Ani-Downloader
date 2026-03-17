export class PlaybackAnalytics {
    constructor(animeName, emitHook) {
        this.animeName = animeName;
        this.emitHook = emitHook;
        this.watchSeconds = 0;
        this.lastTickTime = 0;
        this.timer = null;
        this.currentEpisodeId = null;
    }

    start(episodeId) {
        this.currentEpisodeId = episodeId;
        this.watchSeconds = 0;
        this.lastTickTime = Date.now();
        this.stop();
        this.timer = setInterval(() => {
            const now = Date.now();
            const delta = Math.max(0, Math.floor((now - this.lastTickTime) / 1000));
            this.lastTickTime = now;
            this.watchSeconds += delta;
            this._emit("watch_tick");
        }, 10000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    markDropOff(currentTime, duration) {
        this._emit("drop_off", { currentTime, duration });
    }

    markCompleted(duration) {
        this._emit("completed", { duration });
    }

    _emit(eventType, payload = {}) {
        if (typeof this.emitHook !== "function") return;
        this.emitHook({
            event: eventType,
            anime_name: this.animeName,
            episode_id: this.currentEpisodeId,
            watch_seconds: this.watchSeconds,
            timestamp: Date.now(),
            ...payload
        });
    }
}
