# Anime Streaming Player

This project includes a custom anime-focused web player on:

`/library/<anime_name>`

## Features included

- Custom controls (no default browser UI)
- MP4 / HLS (`.m3u8`) / DASH (`.mpd`) playback support
- Adaptive quality with Auto + manual quality switch
- Server switcher with retry and fallback UI
- Playback speed (0.25x - 3x)
- Volume + mute
- PiP + fullscreen
- Episode list with thumbnails and metadata
- Resume playback (localStorage)
- Auto next episode countdown overlay
- Subtitle tracks (VTT) + subtitle style controls
- Audio track selection (when source provides tracks)
- Skip opening / skip ending buttons from timestamps
- Timeline preview popup (thumbnail-ready)
- Keyboard + touch gestures + double tap seek
- Scene screenshot capture
- Analytics/progress hook support (`window.animePlayerHooks`)

## Setup / runtime notes

The player requires:

- `hls.js` (loaded from CDN in `templates/anime_detail.html`)
- `dash.js` (loaded from CDN in `templates/anime_detail.html`)

No paid external services are required.

## Dynamic config API

The UI fetches:

`GET /api/library/player-config/<anime_name>`

Expected episode config shape:

```json
{
  "video_sources": [],
  "subtitles": [],
  "audio_tracks": [],
  "intro_start": 0,
  "intro_end": 0,
  "outro_start": 0,
  "outro_end": 0,
  "next_episode_url": ""
}
```

Demo sample config file:

- `static/player/demo_config.json`

Demo subtitle file:

- `static/player/sample.vtt`

## API-ready hooks

You can wire backend sync logic via:

```js
window.animePlayerHooks = {
  onProgressSync(payload) {
    // send to your API
  },
  onAnalytics(payload) {
    // watch-time, drop-off, completion events
  },
  onIntroDetectionRequest(payload) {
    // optional: return Promise<{intro_start,intro_end,outro_start,outro_end}>
  }
};
```
