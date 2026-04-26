const crypto = require('crypto')
const OSS = require('ali-oss')

const SERVICE = 'cv'
const REGION = 'cn-north-1'
const HOST = 'visual.volcengineapi.com'
const ALGORITHM = 'HMAC-SHA256'

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

async function submitTask(accessKeyId, secretAccessKey, imageUrl, prompt) {
  const result = await callJimengAPI(accessKeyId, secretAccessKey, 'CVSync2AsyncSubmitTask', {
    req_key: 'jimeng_i2v_first_tail_v30',
    image_urls: [imageUrl, imageUrl],
    prompt,
    seed: -1,
    frames: 121
  })

  if (result.code !== 10000) {
    throw new Error(result.message || '提交任务失败')
  }

  return result.data.task_id
}

async function queryTask(accessKeyId, secretAccessKey, taskId) {
  const result = await callJimengAPI(accessKeyId, secretAccessKey, 'CVSync2AsyncGetResult', {
    req_key: 'jimeng_i2v_first_tail_v30',
    task_id: taskId
  })

  if (result.code !== 10000) {
    throw new Error(result.message || '查询任务失败')
  }

  return {
    status: result.data.status,
    video_url: result.data.video_url
  }
}

async function generateVideo(accessKeyId, secretAccessKey, imageUrl, prompt) {
  console.log('Submitting video generation task...')
  const taskId = await submitTask(accessKeyId, secretAccessKey, imageUrl, prompt)
  console.log('Task submitted, taskId:', taskId)

  const maxRetries = 60
  const retryInterval = 5000

  for (let i = 0; i < maxRetries; i++) {
    console.log(`Polling task status... attempt ${i + 1}/${maxRetries}`)
    await new Promise(resolve => setTimeout(resolve, retryInterval))

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

      return ossUrl
    } else if (result.status === 'expired' || result.status === 'not_found') {
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

    if (!accessKeyId || !secretAccessKey) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: '请配置即梦视频 API 环境变量' })
      }
    }

    // 支持两种模式：直接生成完整视频 或 分步操作（提交/查询）
    if (action === 'generate') {
      // 完整生成模式：提交任务 + 轮询 + 上传OSS
      const { imageUrl, prompt } = body

      if (!imageUrl || !prompt) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing imageUrl or prompt' })
        }
      }

      console.log('Video generation request:', { imageUrl, promptLength: prompt.length })

      const result = await generateVideo(accessKeyId, secretAccessKey, imageUrl, prompt)

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ result })
      }
    } else if (action === 'CVSync2AsyncSubmitTask') {
      // 仅提交任务
      const { image_urls, prompt, seed, frames, req_key } = body

      const result = await callJimengAPI(accessKeyId, secretAccessKey, 'CVSync2AsyncSubmitTask', {
        req_key: req_key || 'jimeng_i2v_first_tail_v30',
        image_urls,
        prompt,
        seed: seed ?? -1,
        frames: frames ?? 121
      })

      // 如果成功，返回task_id
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result)
      }
    } else if (action === 'CVSync2AsyncGetResult') {
      // 仅查询任务
      const { task_id, req_key } = body

      const result = await callJimengAPI(accessKeyId, secretAccessKey, 'CVSync2AsyncGetResult', {
        req_key: req_key || 'jimeng_i2v_first_tail_v30',
        task_id
      })

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

        result.data.video_url = ossUrl
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
