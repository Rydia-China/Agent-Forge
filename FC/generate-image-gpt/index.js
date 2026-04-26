const OSS = require('ali-oss')

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
  const apiBase = baseURL.replace(/\/+$/, '')
  const predictUrl = `${apiBase}/publishers/openai/models/${model}:predict`
  
  console.log('Calling Vertex AI Predict API:', predictUrl)
  
  const instances = [{
    prompt: prompt
  }]
  
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    instances[0].referenceImages = referenceImageUrls.map(url => ({ referenceImage: { gcsUri: url } }))
  }
  
  const requestBody = {
    instances: instances,
    parameters: {
      sampleCount: 1
    }
  }
  
  console.log('Request body:', JSON.stringify({ 
    instances: [{ prompt: prompt.substring(0, 50) + '...', referenceImageCount: referenceImageUrls?.length || 0 }],
    parameters: requestBody.parameters 
  }))
  
  const response = await fetch(predictUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Vertex AI Predict API failed: ${response.status} ${errorText}`)
  }
  
  const result = await response.json()
  console.log('API response received, predictions length:', result.predictions?.length)
  
  if (!result.predictions || result.predictions.length === 0) {
    throw new Error('No predictions in API response')
  }
  
  const prediction = result.predictions[0]
  
  if (prediction.bytesBase64Encoded) {
    const buffer = Buffer.from(prediction.bytesBase64Encoded, 'base64')
    const filename = `gpt-${Date.now()}-${Math.random().toString(36).substring(7)}.png`
    
    console.log('Uploading image to OSS...')
    const url = await uploadToOSS(buffer, filename)
    console.log('Image uploaded to OSS:', url)
    
    return url
  }
  
  throw new Error('No valid image data in prediction')
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

    const { prompt, referenceImageUrls } = body

    if (!prompt || prompt.trim() === '') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Prompt cannot be empty' })
      }
    }

    const baseURL = process.env.GPT_IMAGE_BASE_URL
    const apiKey = process.env.GPT_IMAGE_API_KEY
    const model = body.model || process.env.GPT_IMAGE_MODEL || 'gpt-image-2'

    if (!baseURL || !apiKey) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing API configuration in environment variables (GPT_IMAGE_BASE_URL, GPT_IMAGE_API_KEY)' })
      }
    }

    console.log('Image generation request:', {
      model,
      promptLength: prompt.length,
      referenceImageCount: referenceImageUrls?.length || 0
    })

    const result = await generateImage(prompt, baseURL, apiKey, model, referenceImageUrls)

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
