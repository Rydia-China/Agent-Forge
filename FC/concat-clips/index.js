const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const OSS = require('ali-oss');

const client = new OSS({
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  endpoint: process.env.OSS_ENDPOINT,
});

/**
 * 下载文件到本地
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * 执行 ffmpeg 命令
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 拼接多个视频
 */
async function concatClips(videoUrls) {
  const tmpDir = '/tmp';
  const timestamp = Date.now();
  const inputFiles = [];
  const listFile = path.join(tmpDir, `concat-list-${timestamp}.txt`);
  const outputFile = path.join(tmpDir, `concat-output-${timestamp}.mp4`);
  
  try {
    // 1. 下载所有视频
    console.log('Downloading videos...');
    for (let i = 0; i < videoUrls.length; i++) {
      const inputFile = path.join(tmpDir, `input-${timestamp}-${i}.mp4`);
      await downloadFile(videoUrls[i], inputFile);
      inputFiles.push(inputFile);
      console.log(`Downloaded video ${i + 1}/${videoUrls.length}`);
    }
    
    // 2. 创建 concat 列表文件
    const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(listFile, listContent);
    
    // 3. 使用 ffmpeg concat demuxer 拼接
    console.log('Concatenating videos...');
    await runFFmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputFile
    ]);
    
    // 4. 上传到 OSS
    console.log('Uploading to OSS...');
    const ossKey = `public/video/${timestamp}-concat.mp4`;
    await client.put(ossKey, outputFile);
    
    const ossUrl = `https://${process.env.OSS_BUCKET}.${process.env.OSS_ENDPOINT}/${ossKey}`;
    console.log('Upload complete:', ossUrl);
    
    return ossUrl;
  } finally {
    // 清理临时文件
    [listFile, outputFile, ...inputFiles].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  }
}

/**
 * HTTP 触发器入口
 */
exports.handler = async (req, resp, context) => {
  console.log('Request:', JSON.stringify(req));
  
  // CORS 预检
  if (req.method === 'OPTIONS') {
    resp.setStatusCode(200);
    resp.setHeader('Access-Control-Allow-Origin', '*');
    resp.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    resp.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    resp.send('');
    return;
  }
  
  try {
    // 解析请求体
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { videoUrls } = body;
    
    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
      resp.setStatusCode(400);
      resp.setHeader('Content-Type', 'application/json');
      resp.send(JSON.stringify({ error: 'videoUrls array is required' }));
      return;
    }
    
    // 执行拼接
    const outputUrl = await concatClips(videoUrls);
    
    // 返回结果
    resp.setStatusCode(200);
    resp.setHeader('Content-Type', 'application/json');
    resp.setHeader('Access-Control-Allow-Origin', '*');
    resp.send(JSON.stringify({ videoUrl: outputUrl }));
  } catch (error) {
    console.error('Error:', error);
    resp.setStatusCode(500);
    resp.setHeader('Content-Type', 'application/json');
    resp.setHeader('Access-Control-Allow-Origin', '*');
    resp.send(JSON.stringify({ error: error.message }));
  }
};
