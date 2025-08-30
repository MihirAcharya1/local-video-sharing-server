const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { exec } = require('child_process');

const app = express();
const HTTP_PORT = 5000;
const HTTPS_PORT = 5001;

// Utility: Get local IP
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const HOST = 'localhost' || getLocalIp();

// Folder paths on Android Termux
const UPLOAD_DIR = '/data/data/com.termux/files/home/storage/downloads/MyVideos';
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs');

// Create folders if not exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

// Try load HTTPS certs if available
let credentials = {};
try {
    const privateKey = fs.readFileSync(path.join(__dirname, 'cert/server.key'), 'utf8');
    const certificate = fs.readFileSync(path.join(__dirname, 'cert/server.cert'), 'utf8');
    credentials = { key: privateKey, cert: certificate };
} catch (e) {
    console.warn("⚠️ HTTPS certs not found, running HTTP only.");
}

// Middlewares
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use('/videos', express.static(UPLOAD_DIR));
app.use('/thumbnails', express.static(THUMB_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload endpoint with thumbnail
app.post('/upload', upload.single('video'), (req, res) => {
    const videoPath = path.join(UPLOAD_DIR, req.file.filename);
    const thumbName = req.file.filename + '.jpg';
    const thumbPath = path.join(THUMB_DIR, thumbName);

    exec(`ffmpeg -i "${videoPath}" -ss 00:00:01.000 -vframes 1 "${thumbPath}"`, (err) => {
        if (err) {
            console.error('FFmpeg Error:', err);
            return res.status(500).json({ error: 'Thumbnail generation failed.' });
        }

        res.json({
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            uploadDate: new Date().toISOString(),
            videoUrl: `/videos/${req.file.filename}`,
            thumbnailUrl: `/thumbnails/${thumbName}`
        });
    });
});

// List all videos
app.get('/videos', (req, res) => {
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Read error' });

        const videos = files.filter(f => /\.(mp4|mov|webm|mkv)$/.test(f)).map(f => {
            const stat = fs.statSync(path.join(UPLOAD_DIR, f));
            return {
                name: f,
                size: stat.size,
                uploadDate: stat.mtime.toISOString(),
                url: `/videos/${f}`,
                thumbnail: `/thumbnails/${f}.jpg`
            };
        });

        res.json(videos);
    });
});

// Stream video
app.get('/videos/:filename', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Video not found');

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr);
        const end = endStr ? parseInt(endStr) : stat.size - 1;
        const chunkSize = end - start + 1;

        const stream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4'
        });
        stream.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': 'video/mp4'
        });
        fs.createReadStream(filePath).pipe(res);
    }
});

// Delete video
app.delete('/videos/:filename', (req, res) => {
    const videoPath = path.join(UPLOAD_DIR, req.params.filename);
    const thumbPath = path.join(THUMB_DIR, `${req.params.filename}.jpg`);

    fs.unlink(videoPath, (err) => {
        if (err) return res.status(404).json({ error: 'Video not found' });
        fs.unlink(thumbPath, () => res.json({ success: true }));
    });
});

// Rename video
app.post('/rename', (req, res) => {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'Missing names' });

    const oldVideoPath = path.join(UPLOAD_DIR, oldName);
    const newVideoPath = path.join(UPLOAD_DIR, newName);
    const oldThumbPath = path.join(THUMB_DIR, `${oldName}.jpg`);
    const newThumbPath = path.join(THUMB_DIR, `${newName}.jpg`);

    if (!fs.existsSync(oldVideoPath)) return res.status(404).json({ error: 'Old video not found' });

    fs.rename(oldVideoPath, newVideoPath, (err) => {
        if (err) return res.status(500).json({ error: 'Rename failed' });
        fs.rename(oldThumbPath, newThumbPath, () => res.json({ success: true }));
    });
});

// Manual thumbnail regeneration
app.post('/generate-thumbnail', (req, res) => {
    const { filename } = req.body;
    const videoPath = path.join(UPLOAD_DIR, filename);
    const thumbPath = path.join(THUMB_DIR, `${filename}.jpg`);

    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not found' });

    exec(`ffmpeg -i "${videoPath}" -ss 00:00:01.000 -vframes 1 "${thumbPath}"`, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to generate thumbnail' });
        res.json({ thumbnail: `/thumbnails/${filename}.jpg` });
    });
});

// Start HTTP server
app.listen(HTTP_PORT, HOST, () => {
    console.log(`🌐 HTTP server running: http://${HOST}:${HTTP_PORT}`);
});

// Start HTTPS if certs are valid
if (credentials.key && credentials.cert) {
    https.createServer(credentials, app).listen(HTTPS_PORT, HOST, () => {
        console.log(`🔒 HTTPS server running: https://${HOST}:${HTTPS_PORT}`);
    });
}
