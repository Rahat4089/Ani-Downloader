export class SubtitleController {
    constructor(videoElement) {
        this.video = videoElement;
        this.trackNodes = [];
        this.styleState = {
            size: 18,
            color: "#ffffff",
            background: "#000000",
            opacity: 0.62
        };
        this.video.style.setProperty("--ap-sub-size", `${this.styleState.size}px`);
        this.video.style.setProperty("--ap-sub-color", this.styleState.color);
        this.video.style.setProperty("--ap-sub-bg", "rgba(0, 0, 0, 0.62)");
    }

    clearTracks() {
        this.trackNodes.forEach((node) => node.remove());
        this.trackNodes = [];
    }

    loadTracks(subtitles = []) {
        this.clearTracks();
        subtitles.forEach((track) => {
            const node = document.createElement("track");
            node.kind = track.kind || "subtitles";
            node.label = track.label || "Subtitle";
            node.srclang = track.language || "en";
            node.src = track.src;
            node.default = Boolean(track.default);
            this.video.appendChild(node);
            this.trackNodes.push(node);
        });

        // Wait one frame to let browser create TextTrack objects.
        requestAnimationFrame(() => {
            const textTracks = this.video.textTracks || [];
            for (let i = 0; i < textTracks.length; i += 1) {
                textTracks[i].mode = subtitles[i]?.default ? "showing" : "disabled";
            }
        });
    }

    getTrackOptions() {
        const textTracks = this.video.textTracks || [];
        const options = [{ id: "off", label: "Subtitles Off", language: "" }];
        for (let i = 0; i < textTracks.length; i += 1) {
            const track = textTracks[i];
            options.push({
                id: String(i),
                label: track.label || track.language || `Subtitle ${i + 1}`,
                language: track.language || ""
            });
        }
        return options;
    }

    setActiveTrack(trackId) {
        const textTracks = this.video.textTracks || [];
        for (let i = 0; i < textTracks.length; i += 1) {
            textTracks[i].mode = "disabled";
        }
        if (trackId === "off") return;
        const idx = Number.parseInt(trackId, 10);
        if (Number.isFinite(idx) && textTracks[idx]) {
            textTracks[idx].mode = "showing";
        }
    }

    applyStyle(stylePatch = {}) {
        this.styleState = { ...this.styleState, ...stylePatch };
        const bg = this._hexToRgba(this.styleState.background, this.styleState.opacity);
        this.video.style.setProperty("--ap-sub-size", `${this.styleState.size}px`);
        this.video.style.setProperty("--ap-sub-color", this.styleState.color);
        this.video.style.setProperty("--ap-sub-bg", bg);
    }

    _hexToRgba(hex, alpha) {
        const cleanHex = hex.replace("#", "");
        if (cleanHex.length !== 6) return `rgba(0,0,0,${alpha})`;
        const r = Number.parseInt(cleanHex.slice(0, 2), 16);
        const g = Number.parseInt(cleanHex.slice(2, 4), 16);
        const b = Number.parseInt(cleanHex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
