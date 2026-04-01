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

const download = (url, onProgress) => new Promise((resolve, reject) => {
    if (!isValidUrl(url)) return reject(new Error('URL inválida'));

    const id       = uuidv4().slice(0, 8);
    const outTmpl  = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

    const args = [
        url,
        '-o', outTmpl,
        '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--max-filesize', '50m',
        '--no-warnings',
        '--progress',
        '--newline',
    ];

    const proc  = spawn(YTDLP_PATH, args);
    let output  = '';
    let errOut  = '';
    let title   = 'Video';

    proc.stdout.on('data', (d) => {
        const line = d.toString();
        output += line;
        if (line.includes('[download]') && onProgress) onProgress(line.trim());
        const tm = line.match(/\[info\] (.+): Downloading/);
        if (tm) title = tm[1].slice(0, 80);
    });

    proc.stderr.on('data', (d) => { errOut += d.toString(); });

    proc.on('close', (code) => {
        if (code !== 0) {
            return reject(new Error(errOut.split('\n').filter(Boolean).pop() || 'Error al descargar'));
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

const getHistory = () => loadHistory();

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
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

module.exports = { download, getHistory, deleteDownload, formatSize, DOWNLOADS_DIR };
