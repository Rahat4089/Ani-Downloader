"""
Library API Routes
Handles listing and serving downloaded anime files
"""
from flask import Blueprint, jsonify, send_file, current_app, request
from datetime import datetime
from pathlib import Path
import mimetypes
import os
import shutil
import subprocess
from urllib.parse import quote
from app.utils import login_required

library_bp = Blueprint('library', __name__, url_prefix='/api/library')

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.m3u8', '.mpd'}
SUBTITLE_EXTENSIONS = {'.vtt'}


def _guess_stream_type(filename):
    """Map file extension to player stream type."""
    extension = Path(filename).suffix.lower()
    if extension == '.m3u8':
        return 'hls'
    if extension == '.mpd':
        return 'dash'
    return 'mp4'


def _episode_title_from_filename(filename):
    """Create readable episode title from filename."""
    stem = Path(filename).stem
    normalized = stem.replace('.', ' ').replace('_', ' ').replace('-', ' ').strip()
    return ' '.join(word.capitalize() for word in normalized.split())


def _format_runtime(seconds):
    """Format runtime seconds to HH:MM:SS or MM:SS."""
    if seconds is None or not isinstance(seconds, (int, float)) or seconds < 0:
        return "Unknown"

    total = int(seconds)
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _get_media_duration_seconds(file_path):
    """Read media duration using ffprobe when available."""
    ffprobe_bin = shutil.which('ffprobe')
    if not ffprobe_bin:
        return None
    try:
        result = subprocess.run(
            [
                ffprobe_bin,
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                str(file_path)
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False
        )
        if result.returncode != 0:
            return None
        value = float(result.stdout.strip())
        return value if value > 0 else None
    except Exception:
        return None


def _ensure_episode_thumbnail(anime_path, file_path, duration_seconds):
    """Generate and cache a thumbnail image for a video episode."""
    ffmpeg_bin = shutil.which('ffmpeg')
    if not ffmpeg_bin:
        return None

    try:
        thumbnail_dir = anime_path / '.thumbnails'
        thumbnail_dir.mkdir(exist_ok=True)
        thumbnail_path = thumbnail_dir / f"{file_path.stem}.jpg"

        # Rebuild thumbnail if source was updated.
        if thumbnail_path.exists() and thumbnail_path.stat().st_mtime >= file_path.stat().st_mtime:
            return thumbnail_path

        seek_second = 2
        if duration_seconds and duration_seconds > 20:
            seek_second = int(min(45, max(2, duration_seconds * 0.18)))

        result = subprocess.run(
            [
                ffmpeg_bin,
                '-y',
                '-ss', str(seek_second),
                '-i', str(file_path),
                '-frames:v', '1',
                '-vf', 'scale=480:-1',
                str(thumbnail_path)
            ],
            capture_output=True,
            text=True,
            timeout=12,
            check=False
        )
        if result.returncode != 0 or not thumbnail_path.exists():
            return None
        return thumbnail_path
    except Exception:
        return None


def _build_subtitle_entries(anime_name, anime_path, episode_filename):
    """Build VTT subtitle list for an episode."""
    anime_segment = quote(anime_name, safe='')
    episode_stem = Path(episode_filename).stem.lower()
    subtitles = []
    seen = set()

    for item in sorted(anime_path.iterdir()):
        if not item.is_file():
            continue
        if item.suffix.lower() not in SUBTITLE_EXTENSIONS:
            continue

        subtitle_stem = item.stem.lower()
        # Prefer sidecar subtitles that share episode stem, but include generic folder tracks too.
        if episode_stem not in subtitle_stem and not subtitle_stem.startswith('sub'):
            continue

        label = 'English'
        language = 'en'
        if '.jp' in subtitle_stem or '.ja' in subtitle_stem:
            label = 'Japanese'
            language = 'ja'
        elif '.es' in subtitle_stem:
            label = 'Spanish'
            language = 'es'

        key = (item.name, language)
        if key in seen:
            continue
        seen.add(key)

        subtitles.append({
            "label": label,
            "language": language,
            "kind": "subtitles",
            "default": len(subtitles) == 0,
            "src": f"/api/library/asset/{anime_segment}/{quote(item.name, safe='')}"
        })

    return subtitles


def _is_video_file(filename):
    """Return True if file extension is a supported video format."""
    return Path(filename).suffix.lower() in VIDEO_EXTENSIONS


def _resolve_anime_file_path(anime_name, filename):
    """Safely resolve file path within an anime directory."""
    download_folder = Path(current_app.config['DOWNLOAD_FOLDER']).resolve()
    anime_path = (download_folder / anime_name).resolve()

    if not anime_path.exists() or not anime_path.is_dir():
        return None

    file_path = (anime_path / filename).resolve()
    if not file_path.is_file():
        return None

    # Block path traversal outside the selected anime folder.
    if not file_path.is_relative_to(anime_path):
        return None

    return file_path


def _resolve_anime_dir(anime_name):
    """Safely resolve anime directory within downloads folder."""
    download_folder = Path(current_app.config['DOWNLOAD_FOLDER']).resolve()
    anime_path = (download_folder / anime_name).resolve()

    if not anime_path.exists() or not anime_path.is_dir():
        return None

    if not anime_path.is_relative_to(download_folder):
        return None

    return anime_path


def _send_anime_file(anime_name, filename, as_attachment):
    """Serve a file from a specific anime folder."""
    file_path = _resolve_anime_file_path(anime_name, filename)
    if not file_path:
        return jsonify({"error": "File not found"}), 404

    mimetype, _ = mimetypes.guess_type(file_path.name)
    return send_file(
        file_path,
        as_attachment=as_attachment,
        download_name=file_path.name,
        mimetype=mimetype or 'application/octet-stream',
        conditional=not as_attachment
    )


@library_bp.route('/asset/<path:anime_name>/<path:filename>', methods=['GET'])
@login_required
def serve_anime_asset(anime_name, filename):
    """Serve any in-folder anime asset (video segments, manifests, subtitles)."""
    try:
        file_path = _resolve_anime_file_path(anime_name, filename)
        if not file_path:
            return jsonify({"error": "File not found"}), 404

        mimetype, _ = mimetypes.guess_type(file_path.name)
        return send_file(
            file_path,
            as_attachment=False,
            download_name=file_path.name,
            mimetype=mimetype or 'application/octet-stream',
            conditional=True
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@library_bp.route('/thumbnail/<path:anime_name>/<path:filename>', methods=['GET'])
@login_required
def episode_thumbnail(anime_name, filename):
    """Return a generated thumbnail image for a video episode."""
    try:
        anime_path = _resolve_anime_dir(anime_name)
        file_path = _resolve_anime_file_path(anime_name, filename)
        if not anime_path or not file_path:
            return jsonify({"error": "File not found"}), 404
        if not _is_video_file(file_path.name):
            return jsonify({"error": "Unsupported media type"}), 400

        duration = _get_media_duration_seconds(file_path)
        thumbnail_path = _ensure_episode_thumbnail(anime_path, file_path, duration)
        if not thumbnail_path:
            return send_file(
                Path(current_app.static_folder) / 'player' / 'episode-placeholder.svg',
                mimetype='image/svg+xml'
            )
        return send_file(thumbnail_path, mimetype='image/jpeg', conditional=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/list', methods=['GET'])
@login_required
def list_library():
    """List all downloaded anime titles"""
    try:
        library = []
        download_folder = current_app.config['DOWNLOAD_FOLDER']
        
        if os.path.exists(download_folder):
            for anime_dir in os.listdir(download_folder):
                anime_path = os.path.join(download_folder, anime_dir)
                if os.path.isdir(anime_path):
                    files = os.listdir(anime_path)
                    file_count = len([f for f in files if os.path.isfile(os.path.join(anime_path, f))])
                    
                    total_size = 0
                    for file in files:
                        file_path = os.path.join(anime_path, file)
                        if os.path.isfile(file_path):
                            total_size += os.path.getsize(file_path)
                    
                    library.append({
                        "name": anime_dir,
                        "total_files": file_count,
                        "total_size_mb": round(total_size / (1024 * 1024), 2)
                    })
        
        # Sort by name
        library.sort(key=lambda x: x['name'])
        return jsonify(library)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/anime/<path:anime_name>', methods=['GET'])
@login_required
def get_anime_files(anime_name):
    """Get all files for a specific anime"""
    try:
        download_folder = current_app.config['DOWNLOAD_FOLDER']
        anime_path = os.path.join(download_folder, anime_name)
        
        if not os.path.exists(anime_path) or not os.path.isdir(anime_path):
            return jsonify({"error": "Anime not found"}), 404
        
        files = []
        for file in os.listdir(anime_path):
            file_path = os.path.join(anime_path, file)
            if os.path.isfile(file_path):
                size = os.path.getsize(file_path)
                files.append({
                    "name": file,
                    "size": size,
                    "size_mb": round(size / (1024 * 1024), 2),
                    "size_gb": round(size / (1024 * 1024 * 1024), 2),
                    "modified": datetime.fromtimestamp(os.path.getmtime(file_path)).isoformat(),
                    "is_video": _is_video_file(file)
                })
        
        # Sort by filename
        files.sort(key=lambda x: x['name'])
        
        return jsonify({
            "anime_name": anime_name,
            "files": files,
            "total_files": len(files),
            "total_size_mb": round(sum(f['size'] for f in files) / (1024 * 1024), 2)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@library_bp.route('/anime/<path:anime_name>/files', methods=['DELETE'])
@login_required
def delete_anime_files_bulk(anime_name):
    """Delete multiple episodes/files from a series."""
    try:
        payload = request.get_json(silent=True) or {}
        filenames = payload.get('filenames') or []
        if not isinstance(filenames, list) or not filenames:
            return jsonify({"error": "filenames list is required"}), 400

        deleted = []
        missing = []
        for filename in filenames:
            if not isinstance(filename, str) or not filename.strip():
                continue
            file_path = _resolve_anime_file_path(anime_name, filename)
            if not file_path:
                missing.append(filename)
                continue
            file_path.unlink()
            deleted.append(filename)

        return jsonify({
            "anime_name": anime_name,
            "deleted": deleted,
            "missing": missing
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@library_bp.route('/anime/bulk', methods=['DELETE'])
@login_required
def delete_anime_series_bulk():
    """Delete multiple anime series folders."""
    try:
        payload = request.get_json(silent=True) or {}
        anime_names = payload.get('anime_names') or []
        if not isinstance(anime_names, list) or not anime_names:
            return jsonify({"error": "anime_names list is required"}), 400

        deleted = []
        missing = []
        for anime_name in anime_names:
            if not isinstance(anime_name, str) or not anime_name.strip():
                continue
            anime_path = _resolve_anime_dir(anime_name)
            if not anime_path:
                missing.append(anime_name)
                continue
            shutil.rmtree(anime_path)
            deleted.append(anime_name)

        return jsonify({
            "deleted": deleted,
            "missing": missing
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@library_bp.route('/player-config/<path:anime_name>', methods=['GET'])
@login_required
def get_player_config(anime_name):
    """Return dynamic anime player config payload."""
    try:
        anime_path = _resolve_anime_dir(anime_name)
        if not anime_path:
            return jsonify({"error": "Anime not found"}), 404

        video_files = sorted([
            item for item in anime_path.iterdir()
            if item.is_file() and _is_video_file(item.name)
        ], key=lambda path: path.name.lower())

        if not video_files:
            return jsonify({"error": "No playable files found"}), 404

        episodes = []
        anime_segment = quote(anime_name, safe='')
        for index, file_path in enumerate(video_files):
            stream_type = _guess_stream_type(file_path.name)
            file_segment = quote(file_path.name, safe='')
            primary_url = f"/api/library/asset/{anime_segment}/{file_segment}"
            backup_url = f"/api/library/stream/{anime_segment}/{file_segment}"
            subtitles = _build_subtitle_entries(anime_name, anime_path, file_path.name)
            runtime_seconds = _get_media_duration_seconds(file_path)
            thumbnail_url = f"/api/library/thumbnail/{anime_segment}/{file_segment}?v={int(file_path.stat().st_mtime)}"

            video_sources = [
                {
                    "id": "server-a",
                    "label": "Server A",
                    "type": stream_type,
                    "url": primary_url
                }
            ]
            if stream_type == 'mp4':
                video_sources.append({
                    "id": "server-b",
                    "label": "Server B",
                    "type": stream_type,
                    "url": backup_url
                })

            episode_number = index + 1
            next_episode_url = f"/library/{anime_segment}#ep={episode_number + 1}" if episode_number < len(video_files) else ""

            episodes.append({
                "id": file_path.name,
                "filename": file_path.name,
                "download_url": f"/api/library/download/{anime_segment}/{file_segment}",
                "delete_url": f"/api/library/anime/{anime_segment}/file/{file_segment}",
                "episode_number": episode_number,
                "thumbnail": thumbnail_url,
                "runtime_seconds": runtime_seconds,
                "runtime_label": _format_runtime(runtime_seconds),
                "metadata": {
                    "title": _episode_title_from_filename(file_path.name),
                    "synopsis": f"Episode {episode_number} from {anime_name}. Metadata API hook ready."
                },
                "config": {
                    "video_sources": video_sources,
                    "subtitles": subtitles,
                    "audio_tracks": [],
                    "intro_start": 0,
                    "intro_end": 0,
                    "outro_start": 0,
                    "outro_end": 0,
                    "next_episode_url": next_episode_url,
                    "timeline_thumbnails": []
                }
            })

        return jsonify({
            "anime_name": anime_name,
            "ui_language": "en",
            "seek_short_seconds": 10,
            "seek_long_seconds": 30,
            "auto_next_seconds": 8,
            "episodes": episodes
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/anime/<path:anime_name>', methods=['DELETE'])
@login_required
def delete_anime_series(anime_name):
    """Delete an entire anime series folder."""
    try:
        anime_path = _resolve_anime_dir(anime_name)
        if not anime_path:
            return jsonify({"error": "Anime not found"}), 404

        removed_files = sum(1 for item in anime_path.rglob('*') if item.is_file())
        shutil.rmtree(anime_path)
        return jsonify({
            "message": f"Deleted series '{anime_name}'",
            "deleted_files": removed_files
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/anime/<path:anime_name>/file/<path:filename>', methods=['DELETE'])
@login_required
def delete_anime_file(anime_name, filename):
    """Delete a single episode/file from a series."""
    try:
        file_path = _resolve_anime_file_path(anime_name, filename)
        if not file_path:
            return jsonify({"error": "File not found"}), 404

        file_path.unlink()
        return jsonify({
            "message": f"Deleted '{filename}'",
            "anime_name": anime_name
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/stream/<path:anime_name>/<path:filename>', methods=['GET'])
@login_required
def stream_file(anime_name, filename):
    """Stream video file inline for browser playback."""
    try:
        file_path = _resolve_anime_file_path(anime_name, filename)
        if not file_path:
            return jsonify({"error": "File not found"}), 404
        if not _is_video_file(file_path.name):
            return jsonify({"error": "Unsupported media type"}), 400

        return _send_anime_file(anime_name, filename, as_attachment=False)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/server-stats', methods=['GET'])
@login_required
def server_stats():
    """Return library + server resource stats."""
    try:
        download_folder = Path(current_app.config['DOWNLOAD_FOLDER']).resolve()
        series_count = 0
        episode_count = 0
        total_library_bytes = 0
        video_files_count = 0

        if download_folder.exists():
            for entry in download_folder.iterdir():
                if entry.is_dir():
                    series_count += 1
                    for item in entry.iterdir():
                        if item.is_file():
                            episode_count += 1
                            total_library_bytes += item.stat().st_size
                            if _is_video_file(item.name):
                                video_files_count += 1

        disk_total, disk_used, disk_free = shutil.disk_usage(download_folder)

        mem_total = mem_free = mem_used = None
        try:
            meminfo = {}
            with open('/proc/meminfo', 'r', encoding='utf-8') as mem_file:
                for line in mem_file:
                    key, value = line.split(':', 1)
                    meminfo[key] = int(value.strip().split()[0]) * 1024
            mem_total = meminfo.get('MemTotal')
            mem_free = meminfo.get('MemAvailable')
            if mem_total is not None and mem_free is not None:
                mem_used = mem_total - mem_free
        except Exception:
            pass

        uptime_seconds = None
        try:
            with open('/proc/uptime', 'r', encoding='utf-8') as uptime_file:
                uptime_seconds = int(float(uptime_file.read().split()[0]))
        except Exception:
            pass

        load_avg = None
        try:
            one, five, fifteen = os.getloadavg()
            load_avg = {
                "1m": round(one, 2),
                "5m": round(five, 2),
                "15m": round(fifteen, 2)
            }
        except Exception:
            pass

        return jsonify({
            "series_count": series_count,
            "episode_count": episode_count,
            "video_files_count": video_files_count,
            "library_size_bytes": total_library_bytes,
            "storage": {
                "total_bytes": disk_total,
                "used_bytes": disk_used,
                "free_bytes": disk_free
            },
            "memory": {
                "total_bytes": mem_total,
                "used_bytes": mem_used,
                "free_bytes": mem_free
            },
            "uptime_seconds": uptime_seconds,
            "cpu_count": os.cpu_count(),
            "load_avg": load_avg
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/download/<path:anime_name>/<path:filename>', methods=['GET'])
@login_required
def download_anime_file(anime_name, filename):
    """Download a file from a specific anime directory."""
    try:
        return _send_anime_file(anime_name, filename, as_attachment=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@library_bp.route('/file/<path:filename>', methods=['GET'])
@login_required
def download_file(filename):
    """Download a completed file"""
    try:
        download_folder = current_app.config['DOWNLOAD_FOLDER']
        
        # Search for file in downloads directory
        for root, dirs, files in os.walk(download_folder):
            if filename in files:
                filepath = os.path.join(root, filename)
                if os.path.isfile(filepath):
                    return send_file(
                        filepath, 
                        as_attachment=True,
                        download_name=filename,
                        mimetype='video/mp4'
                    )
        
        return jsonify({"error": f"File not found: {filename}"}), 404
    except Exception as e:
        print(f"Error downloading file '{filename}': {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
