const OSS = require('ali-oss')

const uploadToOSS = async (buffer, filename, folder = 'image') => {
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

/**
 * Create GPT Image 2 task
 */
const createTask = async (baseURL, token, params) => {
  const url = `${baseURL}/api/v2/open/aigc/gpt-image`
  
  console.log('Creating GPT Image 2 task:', { prompt: params.prompt.substring(0, 50) + '...', genType: params.genType })
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(params)
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Create task failed: ${response.status} ${errorText}`)
  }
  
  const result = await response.json()
  console.log('Task created:', result)
  
  if (result.code !== 0) {
    throw new Error(`API error: ${result.msg}`)
  }
  
  return result.data.taskId
}

/**
 * Query task status
 */
const queryTask = async (baseURL, token, taskId) => {
  const url = `${baseURL}/api/v2/open/aigc/${taskId}`
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Query task failed: ${response.status} ${errorText}`)
  }
  
  const result = await response.json()
  
  if (result.code !== 0) {
    throw new Error(`API error: ${result.msg}`)
  }
  
  return result.data
}

/**
 * Poll task until completion
 * - First 30s: poll every 3s
 * - 30s ~ 2min: poll every 5s
 * - After 2min: poll every 10s
 */
const pollTask = async (baseURL, token, taskId, maxWaitMs = 300000) => {
  const startTime = Date.now()
  
  while (Date.now() - startTime < maxWaitMs) {
    const status = await queryTask(baseURL, token, taskId)
    
    console.log('Task status:', { taskId, status: status.status, elapsed: Date.now() - startTime })
    
    if (status.status === 'success') {
      if (!status.result || status.result.length === 0) {
        throw new Error('Task succeeded but no result returned')
      }
      return status.result
    }
    
    if (status.status === 'failed') {
      throw new Error(status.errorMsg || 'Task failed with unknown error')
    }
    
    // Calculate wait time based on elapsed time
    const elapsed = Date.now() - startTime
    let waitMs
    if (elapsed < 30000) {
      waitMs = 3000 // 3s for first 30s
    } else if (elapsed < 120000) {
      waitMs = 5000 // 5s for 30s ~ 2min
    } else {
      waitMs = 10000 // 10s after 2min
    }
    
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  
  throw new Error(`Task polling timeout after ${maxWaitMs}ms`)
}

/**
 * Download image from URL and optionally upload to OSS
 */
const downloadAndUpload = async (imageUrl, skipDownload = false) => {
  if (skipDownload) {
    console.log('Skip download enabled, returning upstream URL directly')
    return imageUrl
  }
  
  console.log('Downloading image from:', imageUrl)
  
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)
  
  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const filename = `gpt-image2-${Date.now()}-${Math.random().toString(36).substring(7)}.png`
    
    console.log('Uploading image to OSS...')
    const ossUrl = await uploadToOSS(buffer, filename)
    console.log('Image uploaded to OSS:', ossUrl)
    
    return ossUrl
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Generate image using GPT Image 2 API
 */
const generateImage = async (prompt, baseURL, token, referenceImageUrls, skipDownload = false) => {
  // Prepare task parameters
  const params = {
    prompt: prompt
  }
  
  // Add image-to-image parameters if reference images provided
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    params.genType = 'i2i'
    params.imageUrls = referenceImageUrls
  }
  
  // Create task
  const taskId = await createTask(baseURL, token, params)
  
  // Poll until completion
  const resultUrls = await pollTask(baseURL, token, taskId)
  
  // Download and upload to OSS (or return upstream URL directly)
  const ossUrl = await downloadAndUpload(resultUrls[0], skipDownload)
  
  return ossUrl
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
    // 打印两个参数
    console.log('=== event ===' )
    console.log('event type:', typeof event, 'isBuffer:', Buffer.isBuffer(event))
    console.log('event keys:', Object.keys(event || {}).slice(0, 20))
    console.log('=== context ===')
    console.log('context:', JSON.stringify(context, null, 2))
    
    let body
    let httpEvent = event
    
    // 如果 event 是 Buffer 或类数组对象，先解码
    if (Buffer.isBuffer(event)) {
      const decoded = event.toString('utf-8')
      console.log('Decoded from Buffer:', decoded.substring(0, 500))
      httpEvent = JSON.parse(decoded)
    } else if (typeof event === 'object' && event !== null && '0' in event) {
      // 类数组对象（FC 传入的 Buffer-like）
      const arr = []
      for (let i = 0; i in event; i++) {
        arr.push(event[i])
      }
      const decoded = Buffer.from(arr).toString('utf-8')
      console.log('Decoded from array-like:', decoded.substring(0, 500))
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
    
    console.log('Parsed request body:', JSON.stringify(body))

    const { prompt, referenceImageUrls, skipDownload } = body

    if (!prompt || prompt.trim() === '') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Prompt cannot be empty' })
      }
    }

    const baseURL = process.env.GPT_IMAGE2_BASE_URL
    const token = process.env.GPT_IMAGE2_TOKEN

    if (!baseURL || !token) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing API configuration in environment variables (GPT_IMAGE2_BASE_URL, GPT_IMAGE2_TOKEN)' })
      }
    }

    console.log('Image generation request:', {
      promptLength: prompt.length,
      referenceImageCount: referenceImageUrls?.length || 0,
      skipDownload: skipDownload || false
    })

    const result = await generateImage(prompt, baseURL, token, referenceImageUrls, skipDownload)

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ result })
    }
  } catch (error) {
    console.error('Image generation error:', error)
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: `exception ${error.message}`,
        details: error.stack
      })
    }
  }
}
