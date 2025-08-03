const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { exec } = require('child_process');

const app = express();
const PORT = 5001;
const HTTPSPORT = 5000;



// Utility: Get local IP for LAN
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

const HOST = getLocalIp()|| 'localhost';

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const THUMB_DIR = path.join(__dirname, 'thumbnails');

// Load SSL certificate and key
const privateKey = fs.readFileSync(path.join(__dirname, 'cert/server.key'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, 'cert/server.cert'), 'utf8');

const credentials = { key: privateKey, cert: certificate };

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR);

// app.use(cors());

app.use(cors({
    origin: '*', // or '*', but less secure
    credentials: true
}));

app.use(express.json());
app.use('/videos', express.static(UPLOAD_DIR));
app.use('/thumbnails', express.static(THUMB_DIR));

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload video + thumbnail generation
app.post('/upload', upload.single('video'), (req, res) => {

    const videoPath = path.join(UPLOAD_DIR, req.file.filename);
    const thumbPath = path.join(THUMB_DIR, `${req.file.filename}.jpg`);

    exec(`ffmpeg -i "${videoPath}" -ss 00:00:01.000 -vframes 1 "${thumbPath}"`, (err) => {
        if (err) {
            console.error('Thumbnail generation error:', err);
            return res.status(500).json({ error: 'Upload succeeded but thumbnail generation failed.' });
        }

        const metadata = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            uploadDate: new Date().toISOString(),
            videoUrl: `/videos/${req.file.filename}`,
            thumbnailUrl: `/thumbnails/${req.file.filename}.jpg`
        };
        res.json(metadata);
    });
});

// Get list of videos
app.get('/videos', (req, res) => {
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to read videos' });

        const videoList = files
            .filter(file => /\.(mp4|webm|mov|mkv)$/.test(file))
            .map(file => {
                const stats = fs.statSync(path.join(UPLOAD_DIR, file));
                return {
                    name: file,
                    url: `/videos/${file}`,
                    thumbnail: `/thumbnails/${file}.jpg`,
                    uploadDate: stats.mtime.toISOString(),
                    size: stats.size
                };
            });

        res.json(videoList);
    });
});

// Delete video + thumbnail
app.delete('/videos/:filename', (req, res) => {
    const videoPath = path.join(UPLOAD_DIR, req.params.filename);
    const thumbPath = path.join(THUMB_DIR, `${req.params.filename}.jpg`);

    fs.unlink(videoPath, (err) => {
        if (err) return res.status(404).json({ error: 'Video not found' });

        fs.unlink(thumbPath, () => {
            // Even if thumbnail doesn't exist, no need to block
            res.json({ success: true });
        });
    });
});

// Rename video + thumbnail
app.post('/rename', (req, res) => {
    const { oldName, newName } = req.body;

    if (!oldName || !newName) {
        return res.status(400).json({ error: 'Both oldName and newName are required.' });
    }

    const oldVideoPath = path.join(UPLOAD_DIR, oldName);
    const newVideoPath = path.join(UPLOAD_DIR, newName);
    const oldThumbPath = path.join(THUMB_DIR, `${oldName}.jpg`);
    const newThumbPath = path.join(THUMB_DIR, `${newName}.jpg`);

    if (!fs.existsSync(oldVideoPath)) {
        return res.status(404).json({ error: 'Video not found.' });
    }

    fs.rename(oldVideoPath, newVideoPath, (err) => {
        if (err) return res.status(500).json({ error: 'Rename failed for video.' });

        fs.rename(oldThumbPath, newThumbPath, (thumbErr) => {
            // Don't fail rename if thumbnail is missing
            if (thumbErr) console.warn('Thumbnail rename failed (may not exist):', thumbErr);
            res.json({ success: true });
        });
    });
});

// Generate thumbnail (manual)
app.post('/generate-thumbnail', (req, res) => {
    const { filename } = req.body;
    const videoPath = path.join(UPLOAD_DIR, filename);
    const thumbPath = path.join(THUMB_DIR, `${filename}.jpg`);

    exec(`ffmpeg -i "${videoPath}" -ss 00:00:01.000 -vframes 1 "${thumbPath}"`, (err) => {
        if (err) return res.status(500).json({ error: 'Thumbnail generation failed' });
        res.json({ thumbnail: `/thumbnails/${filename}.jpg` });
    });
});

// Stream video with Range support
app.get('/videos/:filename', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);

    if (!fs.existsSync(filePath)) return res.status(404).send('Video not found');

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const [start, end] = range.replace(/bytes=/, "").split("-");
        const chunkStart = parseInt(start, 10);
        const chunkEnd = end ? parseInt(end, 10) : fileSize - 1;

        const stream = fs.createReadStream(filePath, { start: chunkStart, end: chunkEnd });
        res.writeHead(206, {
            'Content-Range': `bytes ${chunkStart}-${chunkEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkEnd - chunkStart + 1,
            'Content-Type': 'video/mp4',
        });
        stream.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        });
        fs.createReadStream(filePath).pipe(res);
    }
});




const httpsServer = https.createServer(credentials, app);

httpsServer.listen(HTTPSPORT, HOST, () => {
    console.log(`✅ HTTPS Server running at https://${HOST}:${HTTPSPORT}`);
});

app.listen(PORT, HOST, () => {
    console.log(`✅ Server running at http://${HOST}:${PORT}`);
});
