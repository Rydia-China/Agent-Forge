const crypto = require('crypto')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { writeFile, readFile, unlink, mkdir } = require('fs/promises')
const { existsSync } = require('fs')
const path = require('path')
const OSS = require('ali-oss')

const execFileAsync = promisify(execFile)
const TEMP_DIR = '/tmp/video-generation'
const SERVICE = 'cv'
const REGION = 'cn-north-1'
const HOST = 'visual.volcengineapi.com'
const BYTEPLUS_ARK_SERVICE = 'ark'
const BYTEPLUS_ARK_VERSION = '2024-01-01'
const ALGORITHM = 'HMAC-SHA256'
const DEFAULT_SEEDANCE_MODEL = 'dreamina-seedance-2-0-260128'
const DEFAULT_CONTENT_GENERATION_TASKS_PATH = '/contents/generations/tasks'
const DEFAULT_MODEL_ARK_API_KEY_TTL_SECONDS = 3600
const DEFAULT_ASSET_READY_TIMEOUT_MS = 120000
const DEFAULT_ASSET_READY_INTERVAL_MS = 3000
const DEFAULT_VIDEO_POLL_MAX_RETRIES = 120
const DEFAULT_VIDEO_POLL_INTERVAL_MS = 5000
let cachedModelArkApiKey

async function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true })
  }
}

function generateTempPath(ext) {
  return path.join(TEMP_DIR, `${crypto.randomUUID()}.${ext}`)
}

async function cleanupFiles(files) {
  await Promise.allSettled(files.map((file) => unlink(file)))
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSha256(secretKey, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'request')
  return kSigning
}

function getBytePlusSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSha256(secretKey, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'request')
  return kSigning
}

function getAuthorizationHeader(accessKeyId, secretAccessKey, method, path, query, headers, payload, amzDate) {
  const dateStamp = amzDate.substring(0, 8)

  const canonicalUri = path
  const canonicalQuerystring = query
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('')
  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';')

  const payloadHash = sha256(payload)
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/request`
  const stringToSign = `${ALGORITHM}\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, REGION, SERVICE)
  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  return `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function getBytePlusAuthorizationHeader(accessKeyId, secretAccessKey, method, path, query, headers, payload, amzDate, region, service) {
  const dateStamp = amzDate.substring(0, 8)
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('')
  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';')
  const canonicalRequest = `${method}\n${path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`
  const credentialScope = `${dateStamp}/${region}/${service}/request`
  const stringToSign = `${ALGORITHM}\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`
  const signingKey = getBytePlusSignatureKey(secretAccessKey, dateStamp, region, service)
  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  return `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

async function callJimengAPI(accessKeyId, secretAccessKey, action, payload) {
  const method = 'POST'
  const path = '/'
  const query = `Action=${action}&Version=2022-08-31`

  const payloadStr = JSON.stringify(payload)

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')

  const headers = {
    'Content-Type': 'application/json',
    'Host': HOST,
    'X-Date': amzDate
  }

  const authorization = getAuthorizationHeader(
    accessKeyId,
    secretAccessKey,
    method,
    path,
    query,
    headers,
    payloadStr,
    amzDate
  )

  const response = await fetch(`https://${HOST}?${query}`, {
    method,
    headers: {
      ...headers,
      'Authorization': authorization
    },
    body: payloadStr
  })

  return await response.json()
}

function getBytePlusArkConfig() {
  const accessKeyId = process.env.BYTEPLUS_ACCESS_KEY_ID
  const secretAccessKey = process.env.BYTEPLUS_SECRET_ACCESS_KEY
  const region = process.env.BYTEPLUS_REGION || 'ap-southeast-1'
  const projectName = process.env.BYTEPLUS_PROJECT_NAME || 'default'
  const host = process.env.BYTEPLUS_ARK_HOST || `ark.${region}.byteplusapi.com`

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('请配置 BytePlus Asset API 环境变量 BYTEPLUS_ACCESS_KEY_ID 和 BYTEPLUS_SECRET_ACCESS_KEY')
  }

  return { accessKeyId, secretAccessKey, region, projectName, host }
}

async function callBytePlusArkOpenAPI(action, payload) {
  const config = getBytePlusArkConfig()
  const method = 'POST'
  const path = '/'
  const query = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(BYTEPLUS_ARK_VERSION)}`
  const payloadStr = JSON.stringify(payload)
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const payloadHash = sha256(payloadStr)
  const headers = {
    Host: config.host,
    'X-Content-Sha256': payloadHash,
    'X-Date': amzDate
  }
  const authorization = getBytePlusAuthorizationHeader(
    config.accessKeyId,
    config.secretAccessKey,
    method,
    path,
    query,
    headers,
    payloadStr,
    amzDate,
    config.region,
    BYTEPLUS_ARK_SERVICE
  )

  const response = await fetch(`https://${config.host}?${query}`, {
    method,
    headers: {
      ...headers,
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: payloadStr
  })
  const result = await response.json()

  if (!response.ok || result.ResponseMetadata?.Error) {
    const error = result.ResponseMetadata?.Error
    throw new Error(error?.Message || result.message || result.Message || `${action} failed`)
  }

  return result.Result || result
}

function buildAssetGroupName() {
  const prefix = process.env.BYTEPLUS_ASSET_GROUP_NAME_PREFIX || 'agent-forge-video'
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

function extractId(result, action) {
  if (typeof result?.Id === 'string' && result.Id.length > 0) return result.Id
  if (typeof result?.id === 'string' && result.id.length > 0) return result.id
  throw new Error(`${action} returned no Id`)
}

function extractAssetStatus(result) {
  const rawStatus = result?.Status || result?.status || result?.State || result?.state
  return typeof rawStatus === 'string' ? rawStatus.toLowerCase() : undefined
}

function isAssetReadyStatus(status) {
  return ['available', 'success', 'succeeded', 'done', 'ready', 'active'].includes(status)
}

function isAssetFailedStatus(status) {
  return ['failed', 'error', 'rejected', 'deleted', 'expired'].includes(status)
}

function getAssetName(url, index) {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.split('/').filter(Boolean).pop()
    return pathname || `image-${index + 1}`
  } catch {
    return `image-${index + 1}`
  }
}

async function createAssetGroup() {
  const config = getBytePlusArkConfig()
  const result = await callBytePlusArkOpenAPI('CreateAssetGroup', {
    Name: buildAssetGroupName(),
    Description: 'Agent Forge video generation assets',
    GroupType: 'AIGC',
    ProjectName: config.projectName
  })

  return extractId(result, 'CreateAssetGroup')
}

async function createImageAsset(groupId, url, index) {
  const config = getBytePlusArkConfig()
  const result = await callBytePlusArkOpenAPI('CreateAsset', {
    GroupId: groupId,
    URL: url,
    AssetType: 'Image',
    Name: getAssetName(url, index),
    ProjectName: config.projectName
  })

  return extractId(result, 'CreateAsset')
}

async function getAsset(assetId) {
  const config = getBytePlusArkConfig()
  return callBytePlusArkOpenAPI('GetAsset', {
    Id: assetId,
    ProjectName: config.projectName
  })
}

async function waitForAssetReady(assetId) {
  const timeoutMs = Number(process.env.BYTEPLUS_ASSET_READY_TIMEOUT_MS || DEFAULT_ASSET_READY_TIMEOUT_MS)
  const intervalMs = Number(process.env.BYTEPLUS_ASSET_READY_INTERVAL_MS || DEFAULT_ASSET_READY_INTERVAL_MS)
  const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_ASSET_READY_TIMEOUT_MS)
  const waitMs = Number.isFinite(intervalMs) ? intervalMs : DEFAULT_ASSET_READY_INTERVAL_MS
  let lastStatus = 'unknown'

  while (Date.now() < deadline) {
    const result = await getAsset(assetId)
    const status = extractAssetStatus(result)
    if (!status) return
    lastStatus = status
    if (isAssetReadyStatus(status)) return
    if (isAssetFailedStatus(status)) {
      throw new Error(`Asset ${assetId} processing failed with status ${status}`)
    }
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  throw new Error(`Asset ${assetId} is not ready before timeout, last status: ${lastStatus}`)
}

function isExternalImageUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

async function convertImageUrlsToAssetUris(imageUrls) {
  const normalizedImageUrls = uniqueStrings(imageUrls)
  const urlsToUpload = normalizedImageUrls.filter(isExternalImageUrl)

  if (urlsToUpload.length === 0) return normalizedImageUrls

  const groupId = await createAssetGroup()
  const urlToAssetUri = new Map()

  for (let i = 0; i < urlsToUpload.length; i++) {
    const url = urlsToUpload[i]
    const assetId = await createImageAsset(groupId, url, i)
    await waitForAssetReady(assetId)
    urlToAssetUri.set(url, `asset://${assetId}`)
  }

  return normalizedImageUrls.map(url => urlToAssetUri.get(url) || url)
}

function getModelArkRuntimeConfig() {
  const controlPlaneConfig = getBytePlusArkConfig()
  const apiKey = process.env.ARK_API_KEY
  const endpointId = process.env.ARK_ENDPOINT_ID
  const model = process.env.SEEDANCE_MODEL || DEFAULT_SEEDANCE_MODEL
  const regionBase = controlPlaneConfig.region.replace(/-1$/, '')
  const baseUrl = process.env.ARK_BASE_URL || `https://ark.${regionBase}.bytepluses.com/api/v3`
  const tasksPath = process.env.ARK_CONTENT_GENERATION_TASKS_PATH || DEFAULT_CONTENT_GENERATION_TASKS_PATH
  const ratio = process.env.SEEDANCE_RATIO || '9:16'
  const resolution = process.env.SEEDANCE_RESOLUTION || '720p'
  const watermark = process.env.SEEDANCE_WATERMARK === 'true'
  const generateAudio = process.env.SEEDANCE_GENERATE_AUDIO === 'true'

  return {
    ...controlPlaneConfig,
    apiKey,
    endpointId,
    model,
    baseUrl: baseUrl.replace(/\/$/, ''),
    tasksPath,
    ratio,
    resolution,
    watermark,
    generateAudio
  }
}

async function getModelArkApiKey(config) {
  if (config.apiKey) return config.apiKey

  const now = Date.now()
  if (cachedModelArkApiKey && cachedModelArkApiKey.expiresAt > now + 60000) {
    return cachedModelArkApiKey.value
  }

  if (!config.endpointId) {
    throw new Error('请配置 ARK_API_KEY，或配置 ARK_ENDPOINT_ID 并授予 AK/SK ark:GetApiKey 权限')
  }

  const durationSeconds = Number(process.env.ARK_API_KEY_TTL_SECONDS || DEFAULT_MODEL_ARK_API_KEY_TTL_SECONDS)
  const result = await callBytePlusArkOpenAPI('GetApiKey', {
    DurationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : DEFAULT_MODEL_ARK_API_KEY_TTL_SECONDS,
    ResourceType: 'endpoint',
    ResourceIds: [config.endpointId],
    ProjectName: config.projectName
  })
  const apiKey = result.ApiKey || result.api_key
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('GetApiKey returned no ApiKey')
  }

  cachedModelArkApiKey = {
    value: apiKey,
    expiresAt: now + Math.max(60, durationSeconds - 60) * 1000
  }
  return apiKey
}

function clampDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 5
  return Math.min(15, Math.max(4, Math.round(value)))
}

function getDurationFromOptions(options = {}) {
  if (typeof options.duration === 'number' && Number.isFinite(options.duration)) {
    return clampDuration(options.duration)
  }
  if (typeof options.frames === 'number' && Number.isFinite(options.frames)) {
    return clampDuration(options.frames / 24)
  }
  return clampDuration(undefined)
}

function normalizeRatio(value, fallback) {
  const allowed = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'])
  return typeof value === 'string' && allowed.has(value) ? value : fallback
}

function normalizeResolution(value, fallback) {
  if (typeof value !== 'string') return fallback
  const normalized = value.toLowerCase()
  return normalized === '720p' || normalized === '1080p' ? normalized : fallback
}

function buildModelArkContent(prompt, imageUrls, options = {}) {
  const content = [
    {
      type: 'text',
      text: prompt
    }
  ]

  for (const url of uniqueStrings(imageUrls)) {
    content.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image'
    })
  }

  for (const url of uniqueStrings(options.sourceVideoUrls || [])) {
    content.push({
      type: 'video_url',
      video_url: { url },
      role: 'reference_video'
    })
  }

  return content
}

async function callModelArkRuntime(path, method, payload) {
  const config = getModelArkRuntimeConfig()
  const apiKey = await getModelArkApiKey(config)
  const normalizedPath = config.baseUrl.endsWith('/api/v3') && path.startsWith('/api/v3/')
    ? path.slice('/api/v3'.length)
    : path
  const url = new URL(`${config.baseUrl}${normalizedPath}`)
  const payloadStr = payload === undefined ? '' : JSON.stringify(payload)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: method === 'GET' ? undefined : payloadStr
  })
  const text = await response.text()
  const result = text.length > 0 ? JSON.parse(text) : {}

  if (!response.ok || result.error) {
    const error = result.error
    const message = error?.message || error?.Message || result.message || result.Message || `ModelArk ${method} ${path} failed`
    throw new Error(message)
  }

  return result
}

async function submitModelArkVideoTask(imageUrls, prompt, options = {}) {
  const config = getModelArkRuntimeConfig()
  const assetImageUrls = await convertImageUrlsToAssetUris(imageUrls)
  const payload = {
    model: config.model,
    content: buildModelArkContent(prompt, assetImageUrls, options),
    ratio: normalizeRatio(options.ratio, config.ratio),
    resolution: normalizeResolution(options.resolution, config.resolution),
    duration: getDurationFromOptions(options),
    watermark: config.watermark,
    generate_audio: config.generateAudio
  }

  const result = await callModelArkRuntime(config.tasksPath, 'POST', payload)
  return extractId(result, 'CreateContentGenerationTask')
}

async function queryModelArkVideoTask(taskId) {
  const config = getModelArkRuntimeConfig()
  const result = await callModelArkRuntime(`${config.tasksPath}/${encodeURIComponent(taskId)}`, 'GET')
  const statusMap = {
    succeeded: 'done',
    failed: 'failed',
    cancelled: 'failed',
    canceled: 'failed'
  }

  return {
    status: statusMap[result.status] || result.status || 'running',
    video_url: result.content?.video_url || result.output?.video_url || result.video_url,
    raw: result
  }
}

const uploadToOSS = async (buffer, filename, folder = 'video') => {
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

async function extractLastFrameToOSS(videoBuffer) {
  await ensureTempDir()

  const inputPath = generateTempPath('mp4')
  const outputPath = generateTempPath('png')

  try {
    await writeFile(inputPath, videoBuffer)
    await execFileAsync('ffmpeg', [
      '-y',
      '-sseof',
      '-0.1',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      outputPath,
    ])

    const frameBuffer = await readFile(outputPath)
    const filename = `last-frame-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`
    return uploadToOSS(frameBuffer, filename, 'video-frames')
  } finally {
    await cleanupFiles([inputPath, outputPath])
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))]
}

async function submitTask(accessKeyId, secretAccessKey, imageUrls, prompt, options = {}) {
  return submitModelArkVideoTask(imageUrls, prompt, options)
}

async function queryTask(accessKeyId, secretAccessKey, taskId) {
  return queryModelArkVideoTask(taskId)
}

async function generateVideo(accessKeyId, secretAccessKey, imageUrls, prompt, options = {}) {
  console.log('Submitting video generation task...')
  const taskId = await submitTask(accessKeyId, secretAccessKey, imageUrls, prompt, options)
  console.log('Task submitted, taskId:', taskId)

  const maxRetries = Number(process.env.SEEDANCE_POLL_MAX_RETRIES || DEFAULT_VIDEO_POLL_MAX_RETRIES)
  const retryInterval = Number(process.env.SEEDANCE_POLL_INTERVAL_MS || DEFAULT_VIDEO_POLL_INTERVAL_MS)
  const retryCount = Number.isFinite(maxRetries) ? maxRetries : DEFAULT_VIDEO_POLL_MAX_RETRIES
  const waitMs = Number.isFinite(retryInterval) ? retryInterval : DEFAULT_VIDEO_POLL_INTERVAL_MS

  for (let i = 0; i < retryCount; i++) {
    console.log(`Polling task status... attempt ${i + 1}/${retryCount}`)
    await new Promise(resolve => setTimeout(resolve, waitMs))

    const result = await queryTask(accessKeyId, secretAccessKey, taskId)
    console.log('Task status:', result.status)

    if (result.status === 'done' && result.video_url) {
      console.log('Video generated, downloading from:', result.video_url)

      const videoResponse = await fetch(result.video_url)
      if (!videoResponse.ok) {
        throw new Error('下载视频失败')
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
      const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`

      console.log('Uploading video to OSS...')
      const ossUrl = await uploadToOSS(videoBuffer, filename)
      console.log('Video uploaded to OSS:', ossUrl)

      console.log('Extracting last frame...')
      const lastFrameUrl = await extractLastFrameToOSS(videoBuffer)
      console.log('Last frame uploaded to OSS:', lastFrameUrl)

      return { videoUrl: ossUrl, lastFrameUrl }
    } else if (['expired', 'not_found', 'failed'].includes(result.status)) {
      throw new Error(`任务失败: ${result.status}`)
    }
  }

  throw new Error('视频生成超时')
}

// 阿里云FC HTTP触发器入口
exports.handler = async (event, context) => {
  // 设置CORS响应头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  // 处理OPTIONS预检请求
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
    
    // 如果 event 是 Buffer 或类数组对象，先解码
    if (Buffer.isBuffer(event)) {
      const decoded = event.toString('utf-8')
      httpEvent = JSON.parse(decoded)
    } else if (typeof event === 'object' && event !== null && '0' in event) {
      // 类数组对象（FC 传入的 Buffer-like）
      const arr = []
      for (let i = 0; i in event; i++) {
        arr.push(event[i])
      }
      const decoded = Buffer.from(arr).toString('utf-8')
      httpEvent = JSON.parse(decoded)
    }
    
    // 标准的 HTTP 触发器参数解析
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

    const { action } = body

    const accessKeyId = process.env.JIMENG_ACCESS_KEY_ID
    const secretAccessKey = process.env.JIMENG_SECRET_ACCESS_KEY

    // 支持两种模式：直接生成完整视频 或 分步操作（提交/查询）
    if (action === 'generate') {
      // 完整生成模式：提交任务 + 轮询 + 上传OSS
      const { imageUrl, prompt, referenceImageUrls, sourceVideoUrls, duration, ratio, resolution } = body

      if (!imageUrl || !prompt) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing imageUrl or prompt' })
        }
      }

      const imageUrls = uniqueStrings([imageUrl, ...((Array.isArray(referenceImageUrls) ? referenceImageUrls : []))])
      const frames = typeof duration === 'number' && Number.isFinite(duration)
        ? Math.max(1, Math.round(duration * 24))
        : undefined

      console.log('Video generation request:', {
        imageUrl,
        referenceImageCount: imageUrls.length,
        sourceVideoCount: Array.isArray(sourceVideoUrls) ? sourceVideoUrls.length : 0,
        ratio,
        resolution,
        promptLength: prompt.length
      })

      const result = await generateVideo(accessKeyId, secretAccessKey, imageUrls, prompt, {
        sourceVideoUrls: Array.isArray(sourceVideoUrls) ? sourceVideoUrls : [],
        frames,
        duration,
        ratio,
        resolution
      })

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ result })
      }
    } else if (action === 'CVSync2AsyncSubmitTask') {
      // 仅提交任务
      const { image_urls, prompt, frames, sourceVideoUrls, video_urls, duration, ratio, resolution } = body

      const continuationVideos = uniqueStrings([
        ...((Array.isArray(video_urls) ? video_urls : [])),
        ...((Array.isArray(sourceVideoUrls) ? sourceVideoUrls : []))
      ])
      const taskId = await submitTask(accessKeyId, secretAccessKey, Array.isArray(image_urls) ? image_urls : [], prompt, {
        sourceVideoUrls: continuationVideos,
        frames,
        duration,
        ratio,
        resolution
      })
      const result = {
        code: 10000,
        data: { task_id: taskId },
        message: 'Success',
        status: 10000
      }

      // 如果成功，返回task_id
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result)
      }
    } else if (action === 'CVSync2AsyncGetResult') {
      // 仅查询任务
      const { task_id, req_key } = body

      const taskResult = await queryTask(accessKeyId, secretAccessKey, task_id)
      const result = {
        code: 10000,
        data: {
          status: taskResult.status,
          video_url: taskResult.video_url,
          raw: taskResult.raw
        },
        message: 'Success',
        status: 10000
      }

      // 如果完成且有视频，下载并上传到OSS
      if (result.code === 10000 && result.data?.video_url && result.data?.status === 'done') {
        const videoUrl = result.data.video_url

        const videoResponse = await fetch(videoUrl)
        if (!videoResponse.ok) {
          throw new Error('下载视频失败')
        }

        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
        const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`
        const ossUrl = await uploadToOSS(videoBuffer, filename)
        const lastFrameUrl = await extractLastFrameToOSS(videoBuffer)

        result.data.video_url = ossUrl
        result.data.last_frame_url = lastFrameUrl
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result)
      }
    } else {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid action. Use "generate", "CVSync2AsyncSubmitTask", or "CVSync2AsyncGetResult"' })
      }
    }
  } catch (error) {
    console.error('Video generation error:', error)
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
