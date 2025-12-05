const express = require("express");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

let currentFile = "video2.mp4";
let ffmpegProcess = null;

// Ensure HLS folder exists
const HLS_DIR = path.join(__dirname, "public/hls");
if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
}

// Function to clear old HLS segments (prevents huge buffer)
function clearHlsFolder() {
    if (fs.existsSync(HLS_DIR)) {
        fs.readdirSync(HLS_DIR).forEach(file => {
            if (file.endsWith(".ts") || file.endsWith(".m3u8")) {
                fs.unlinkSync(path.join(HLS_DIR, file));
            }
        });
    }
}


// Start FFmpeg process
function startStream() {
    if (ffmpegProcess) {
        ffmpegProcess.kill("SIGKILL");
    }

    // Clear old segments
    clearHlsFolder();

    console.log("🎬 Starting stream:", currentFile);

    ffmpegProcess = spawn("ffmpeg", [
        "-stream_loop", "-1",  // LOOP VIDEO FOREVER
        "-re",
        "-i", `videos/${currentFile}`,

        // Stable encoding
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",

        // Stable video quality
        "-b:v", "1500k",
        "-maxrate", "2000k",
        "-bufsize", "3000k",

        // Force FPS
        "-r", "30",
        // Perfect GOP for low latency
        "-g", "60",
        "-sc_threshold", "0",

        // Low latency HLS
        "-hls_time", "2",
        "-hls_list_size", "10",
        "-hls_flags", "delete_segments+append_list",

        "-hls_base_url", "/hls/",
        "-hls_segment_filename", path.join(HLS_DIR, "index%03d.ts"), // Defines how segment files are named.
        path.join(HLS_DIR, "index.m3u8") // Final output: index.m3u8
    ]);

    ffmpegProcess.stderr.on("data", d => console.log("FFmpeg:", d.toString()));
    ffmpegProcess.on("close", () => console.log("⛔ FFmpeg stopped"));
}

// Start first time
startStream();

// API to switch mp4 files
app.post("/switch", (req, res) => {
    const { video } = req.body;
    if (!video) return res.status(400).json({ error: "Video name missing" });

    const filePath = `videos/${video}`;
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "MP4 not found" });
    }

    currentFile = video;
    startStream();

    res.json({ message: "Switched", current: currentFile });
});

// Serve HLS playlist
app.get("/live.m3u8", (req, res) => {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.sendFile(path.join(__dirname, "public/hls/index.m3u8"));
});

// Serve segments .ts
app.get("/hls/:segment", (req, res) => {
    const segmentPath = path.join(__dirname, "public/hls", req.params.segment);
    if (!fs.existsSync(segmentPath)) return res.status(404).end();
    res.sendFile(segmentPath);
});

app.listen(3050, () => console.log("🚀 Live stream running on port 3050"));
