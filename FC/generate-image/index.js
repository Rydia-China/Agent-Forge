const OSS = require('ali-oss')

let GoogleGenAI = null

const getGoogleGenAI = async () => {
  if (!GoogleGenAI) {
    const module = await import('@google/genai')
    GoogleGenAI = module.GoogleGenAI
  }
  return GoogleGenAI
}

const DEFAULT_GEMINI_MODEL = 'google/gemini-3-pro-image-preview'

const resolveGeminiModel = (model) => {
  const requestedModel = typeof model === 'string' ? model.trim() : ''
  if (!requestedModel || requestedModel.toLowerCase() === 'gemini') {
    return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  }
  return requestedModel
}

const downloadImageAsBase64 = async (url) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  })

  clearTimeout(timeoutId)

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const base64 = buffer.toString('base64')
  const contentType = response.headers.get('content-type') || 'image/jpeg'

  return {
    data: base64,
    mimeType: contentType
  }
}

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

const generateImage = async (prompt, baseURL, apiKey, model, referenceImageUrls) => {
  const baseUrl = baseURL.replace('/api/v1', '/api/vertex-ai')

  const GenAI = await getGoogleGenAI()
  const client = new GenAI({
    apiKey: apiKey,
    vertexai: true,
    httpOptions: {
      apiVersion: 'v1',
      baseUrl: baseUrl
    }
  })

  const contents = []

  // 添加文本提示词
  if (prompt) {
    contents.push({ text: prompt })
  }

  // 下载参考图片并转base64
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    console.log('Downloading reference images:', referenceImageUrls.length)
    for (let i = 0; i < referenceImageUrls.length; i++) {
      const url = referenceImageUrls[i]
      console.log(`Downloading reference image ${i + 1}/${referenceImageUrls.length}:`, url)
      const imageData = await downloadImageAsBase64(url)
      contents.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.data
        }
      })
      console.log(`Downloaded reference image ${i + 1}/${referenceImageUrls.length} successfully`)
    }
  }

  if (contents.length === 0) {
    contents.push({ text: prompt })
  }

  console.log('Calling Google GenAI API...')
  const response = await client.models.generateContent({
    model: model || 'google/gemini-3-pro-image-preview',
    contents: contents,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  })

  console.log('API response received')

  if (response.candidates && response.candidates[0]) {
    const content = response.candidates[0].content

    if (content && content.parts && Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const buffer = Buffer.from(part.inlineData.data, 'base64')
          const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.png`

          console.log('Uploading image to OSS...')
          const url = await uploadToOSS(buffer, filename)
          console.log('Image uploaded to OSS:', url)

          return url
        }
      }
    }
  }

  throw new Error('No image generated from API response')
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

    const { prompt, referenceImageUrls, refUrls, model: bodyModel } = body
    const effectiveReferenceImageUrls = referenceImageUrls || refUrls

    if (!prompt || prompt.trim() === '') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Prompt cannot be empty' })
      }
    }

    const baseURL = process.env.GEMINI_BASE_URL
    const apiKey = process.env.GEMINI_API_KEY
    const model = resolveGeminiModel(bodyModel || process.env.GEMINI_MODEL)

    if (!baseURL || !apiKey) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing API configuration in environment variables' })
      }
    }

    console.log('Image generation request:', {
      model,
      promptLength: prompt.length,
      referenceImageCount: effectiveReferenceImageUrls?.length || 0
    })

    const result = await generateImage(prompt, baseURL, apiKey, model, effectiveReferenceImageUrls)

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
