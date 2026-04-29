const { exec } = require('child_process')
const { promisify } = require('util')
const { writeFile, unlink, mkdir } = require('fs/promises')
const { existsSync } = require('fs')
const path = require('path')
const crypto = require('crypto')
const OSS = require('ali-oss')

const execAsync = promisify(exec)

const TEMP_DIR = '/tmp/video-processing'

async function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true })
  }
}

async function downloadVideo(url, destPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(destPath, buffer)
}

function generateTempPath(ext) {
  return path.join(TEMP_DIR, `${crypto.randomUUID()}.${ext}`)
}

async function cleanupFiles(files) {
  await Promise.allSettled(files.map((file) => unlink(file)))
}

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`)
  }
}

async function getVideoDuration(inputPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${inputPath}"`
  )
  const duration = Number(stdout.trim())
  assertFiniteNumber(duration, 'video duration')
  return duration
}

async function uploadToOSS(buffer, filename, folder = 'video') {
  const client = new OSS({
    region: process.env.OSS_REGION,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    endpoint: process.env.OSS_ENDPOINT || `oss-${process.env.OSS_REGION}.aliyuncs.com`,
    secure: true,
    timeout: 300000,
  })

  const objectName = `public/${folder}/${filename}`
  await client.put(objectName, buffer)

  const bucket = process.env.OSS_BUCKET
  const region = process.env.OSS_REGION
  const url = `https://${bucket}.oss-${region}.aliyuncs.com/${objectName}`

  return url
}

async function cropVideo(videoUrl, options) {
  await ensureTempDir()

  const inputPath = generateTempPath('mp4')
  const outputPath = generateTempPath('mp4')

  try {
    console.log('Downloading video from:', videoUrl)
    await downloadVideo(videoUrl, inputPath)

    let startTime = options.startTime
    let endTime = options.endTime
    if (options.tailSeconds !== undefined) {
      assertFiniteNumber(options.tailSeconds, 'tailSeconds')
      if (options.tailSeconds <= 0) throw new Error('tailSeconds must be greater than 0')
      const sourceDuration = await getVideoDuration(inputPath)
      startTime = Math.max(0, sourceDuration - options.tailSeconds)
      endTime = sourceDuration
    }

    assertFiniteNumber(startTime, 'startTime')
    assertFiniteNumber(endTime, 'endTime')
    if (startTime < 0 || endTime <= startTime) {
      throw new Error('Invalid crop range')
    }

    console.log('Cropping video:', { startTime, endTime })
    const duration = endTime - startTime
    await execAsync(
      `ffmpeg -i "${inputPath}" -ss ${startTime} -t ${duration} -c copy "${outputPath}"`
    )

    console.log('Reading cropped video')
    const fs = require('fs')
    const buffer = fs.readFileSync(outputPath)
    
    const filename = `cropped-${Date.now()}.mp4`
    console.log('Uploading to OSS:', filename)
    const url = await uploadToOSS(buffer, filename)

    console.log('Video cropped and uploaded:', url)
    return url
  } finally {
    await cleanupFiles([inputPath, outputPath])
  }
}

// 阿里云FC HTTP触发器入口
exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    }
  }

  try {
    let body
    let httpEvent = event
    
    if (Buffer.isBuffer(event)) {
      const decoded = event.toString('utf-8')
      httpEvent = JSON.parse(decoded)
    } else if (typeof event === 'object' && event !== null && '0' in event) {
      const arr = []
      for (let i = 0; i in event; i++) {
        arr.push(event[i])
      }
      const decoded = Buffer.from(arr).toString('utf-8')
      httpEvent = JSON.parse(decoded)
    }
    
    if (httpEvent.body) {
      const bodyStr = httpEvent.isBase64Encoded 
        ? Buffer.from(httpEvent.body, 'base64').toString() 
        : httpEvent.body
      try {
        body = JSON.parse(bodyStr)
      } catch (parseError) {
        body = bodyStr
      }
    } else {
      body = httpEvent.queryStringParameters || httpEvent
    }

    const { videoUrl, startTime, endTime, tailSeconds } = body

    if (!videoUrl || (tailSeconds === undefined && (startTime === undefined || endTime === undefined))) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing videoUrl and either tailSeconds or startTime/endTime' })
      }
    }

    console.log('Crop video request:', { videoUrl, startTime, endTime, tailSeconds })

    const result = await cropVideo(videoUrl, { startTime, endTime, tailSeconds })

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ result })
    }
  } catch (error) {
    console.error('Crop video error:', error)
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message,
        details: error.stack
      })
    }
  }
}
