const { spawn } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR      = path.join(__dirname, '../data');
const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
const HISTORY_FILE  = path.join(DATA_DIR, 'downloads_history.json');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const loadHistory = () => {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
    catch { return []; }
};

const saveHistory = (h) => fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));

const YTDLP_PATH = 'yt-dlp';

const isValidUrl = (str) => {
    try { new URL(str); return true; } catch { return false; }
};

// ── Quality presets ───────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    'best':   { fmt: 'bestvideo+bestaudio/best',                                    label: 'Máxima calidad' },
    '2160p':  { fmt: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best',   label: '4K (2160p)' },
    '1080p':  { fmt: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',   label: 'Full HD (1080p)' },
    '720p':   { fmt: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',     label: 'HD (720p)' },
    '480p':   { fmt: 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',     label: 'SD (480p)' },
    '360p':   { fmt: 'bestvideo[height<=360]+bestaudio/best[height<=360]/best',     label: 'Baja (360p)' },
    'audio':  { fmt: 'bestaudio/best', label: 'Solo audio (MP3)', audioOnly: true },
};

// ── Format presets ────────────────────────────────────────────────────────────
const FORMAT_PRESETS = {
    'mp4':  'mp4',
    'webm': 'webm',
    'mp3':  'mp3',
    'm4a':  'm4a',
};

const QUALITY_ALIASES = {
    'max': 'best', 'maximum': 'best', 'highest': 'best', 'mejor': 'best', 'máxima': 'best', 'maxima': 'best', 'alta': 'best',
    'hd': '720p', 'medium': '720p', 'normal': '720p', 'media': '720p',
    'low': '360p', 'lowest': '360p', 'baja': '360p', 'menor': '360p', 'pequeña': '360p', 'pequeña': '360p',
    'sd': '480p',
    'full': '1080p', 'fullhd': '1080p', 'full hd': '1080p', 'fhd': '1080p',
    '4k': '2160p', 'uhd': '2160p',
    'mp3': 'audio', 'music': 'audio', 'audio only': 'audio', 'sound': 'audio', 'musica': 'audio', 'música': 'audio',
};

const getQualityPreset = (quality) => {
    if (!quality) return QUALITY_PRESETS['720p'];
    const q = String(quality).toLowerCase().trim();
    const resolved = QUALITY_ALIASES[q] || q;
    return QUALITY_PRESETS[resolved] || QUALITY_PRESETS['720p'];
};

// ── Download ──────────────────────────────────────────────────────────────────
const download = (url, opts = {}, onProgress) => new Promise((resolve, reject) => {
    if (!isValidUrl(url)) return reject(new Error('URL inválida'));

    const quality  = getQualityPreset(opts.quality);
    const audioOnly = quality.audioOnly || opts.format === 'mp3' || opts.format === 'm4a';
    const outFmt   = audioOnly ? 'mp3' : (FORMAT_PRESETS[opts.format] || 'mp4');

    const id      = uuidv4().slice(0, 8);
    const outExt  = audioOnly ? 'mp3' : '%(ext)s';
    const outTmpl = path.join(DOWNLOADS_DIR, `${id}.${outExt}`);

    const args = [
        url,
        '-o', outTmpl,
        '--format', quality.fmt,
        '--no-playlist',
        '--max-filesize', '100m',
        '--no-warnings',
        '--progress',
        '--newline',
    ];

    if (audioOnly) {
        args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
        args.push('--merge-output-format', outFmt);
    }

    const proc = spawn(YTDLP_PATH, args);
    let output = '';
    let errOut = '';
    let title  = 'Video';

    proc.stdout.on('data', (d) => {
        const chunk = d.toString();
        output += chunk;
        for (const line of chunk.split('\n')) {
            if (line.includes('[download]') && onProgress) onProgress(line.trim());
            const tm = line.match(/\[(?:info|youtube|instagram|tiktok|twitter|generic)\] [^:]+: (.+)/i);
            if (tm && tm[1].trim().length > 3 && !tm[1].startsWith('Downloading') && !tm[1].startsWith('Writing')) {
                title = tm[1].trim().slice(0, 80);
            }
        }
    });

    proc.stderr.on('data', (d) => { errOut += d.toString(); });

    proc.on('close', (code) => {
        if (code !== 0) {
            const lines = errOut.split('\n').filter(l => l.trim() && !l.startsWith('WARNING') && !l.startsWith('[debug]'));
            const lastErr = lines.pop() || 'Error al descargar';
            return reject(new Error(lastErr.replace(/^ERROR: /, '')));
        }

        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => f.startsWith(id))
            .map(f => path.join(DOWNLOADS_DIR, f));

        if (files.length === 0) return reject(new Error('No se encontró el archivo descargado'));

        const filePath = files[0];
        const stat     = fs.statSync(filePath);

        const entry = {
            id,
            url,
            title,
            filename:  path.basename(filePath),
            filepath:  filePath,
            size:      stat.size,
            ext:       path.extname(filePath).slice(1),
            quality:   quality.label,
            createdAt: new Date().toISOString(),
        };

        const history = loadHistory();
        history.unshift(entry);
        if (history.length > 50) history.length = 50;
        saveHistory(history);

        resolve(entry);
    });

    proc.on('error', (e) => reject(new Error(`yt-dlp no encontrado: ${e.message}`)));
});

const getHistory    = ()   => loadHistory();
const getQualities  = ()   => Object.entries(QUALITY_PRESETS).map(([k, v]) => ({ id: k, label: v.label }));

const deleteDownload = (id) => {
    let history = loadHistory();
    const entry = history.find(e => e.id === id);
    if (!entry) return false;
    if (fs.existsSync(entry.filepath)) fs.unlinkSync(entry.filepath);
    history = history.filter(e => e.id !== id);
    saveHistory(history);
    return true;
};

const formatSize = (bytes) => {
    if (!bytes) return '?';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

module.exports = { download, getHistory, deleteDownload, formatSize, getQualities, getQualityPreset, DOWNLOADS_DIR };
