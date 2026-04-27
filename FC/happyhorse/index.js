const axios = require('axios');
const OSS = require('ali-oss');

/**
 * HappyHorse Video Generation FC Wrapper
 * Wraps DashScope HappyHorse API for Function Compute deployment
 */

const HAPPYHORSE_BASE_URL = 'https://mm-internal-cn.leonecloud.com';

/**
 * Validate video URL
 * @param {string} url - Video URL
 * @throws {Error} If validation fails
 */
function validateVideoUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Video URL is required and must be a string');
  }

  // Check protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Video URL must use HTTP or HTTPS protocol');
  }

  // Check file extension (must be .mp4)
  if (!url.toLowerCase().endsWith('.mp4')) {
    throw new Error('Video must be in MP4 format');
  }
}

/**
 * Validate reference image URL
 * @param {string} url - Image URL
 * @throws {Error} If validation fails
 */
function validateImageUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Image URL is required and must be a string');
  }

  // Check protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Image URL must use HTTP or HTTPS protocol');
  }

  // Check file extension (common image formats)
  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const hasValidExtension = validExtensions.some(ext => url.toLowerCase().endsWith(ext));
  
  if (!hasValidExtension) {
    throw new Error(`Image must be in one of these formats: ${validExtensions.join(', ')}`);
  }
}

/**
 * Validate media array
 * @param {Array} media - Media array
 * @throws {Error} If validation fails
 */
function validateMedia(media) {
  if (!Array.isArray(media)) {
    throw new Error('Media must be an array');
  }

  let hasVideo = false;
  let imageCount = 0;

  for (const item of media) {
    if (!item.type || !item.url) {
      throw new Error('Each media item must have "type" and "url" fields');
    }

    if (item.type === 'video') {
      if (hasVideo) {
        throw new Error('Only one video is allowed in media array');
      }
      validateVideoUrl(item.url);
      hasVideo = true;
    } else if (item.type === 'reference_image') {
      validateImageUrl(item.url);
      imageCount++;
    } else {
      throw new Error(`Invalid media type: ${item.type}. Must be "video" or "reference_image"`);
    }
  }

  // At least one media item is required
  if (media.length === 0) {
    throw new Error('At least one media item (video or reference_image) is required');
  }
}

/**
 * Create a HappyHorse video generation task
 */
async function createTask(apiKey, request) {
  const { prompt, media, resolution, ratio, duration, model } = request;

  // Validate required fields
  if (!prompt) {
    throw new Error('Prompt is required');
  }

  if (!media || !Array.isArray(media) || media.length === 0) {
    throw new Error('Media array is required and must not be empty');
  }

  // Validate media
  validateMedia(media);

  // Convert new DashScope format to old HappyHorse format
  // Extract video and images from media array
  const videoItem = media.find(item => item.type === 'video');
  const imageItems = media.filter(item => item.type === 'reference_image');

  // Build old-style flat request format
  const legacyRequest = {
    prompt,
    genType: (videoItem || imageItems.length > 0) ? 'i2v' : 't2v', // i2v if any media, otherwise t2v
  };

  // Add image URLs array (video goes first if present)
  const imageUrls = [];
  if (videoItem) {
    imageUrls.push(videoItem.url);
  }
  if (imageItems.length > 0) {
    imageUrls.push(...imageItems.map(item => item.url));
  }
  if (imageUrls.length > 0) {
    legacyRequest.imageUrls = imageUrls;
  }

  // Add optional parameters
  if (resolution) {
    legacyRequest.resolution = resolution;
  }
  if (ratio) {
    legacyRequest.ratio = ratio;
  }
  if (duration) {
    legacyRequest.duration = duration;
  }

  console.log('HappyHorse request (legacy format):', JSON.stringify(legacyRequest, null, 2));

  const response = await axios.post(
    `${HAPPYHORSE_BASE_URL}/api/v2/open/aigc/hh`,
    legacyRequest,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  console.log('HappyHorse response:', JSON.stringify(response.data, null, 2));

  // Old HappyHorse response format
  if (response.data.code !== 0) {
    throw new Error(response.data.msg || 'Create task failed');
  }

  const data = response.data.data || {};
  const taskId = data.taskId;

  if (!taskId) {
    throw new Error('No taskId in response');
  }

  return {
    taskId,
    status: data.status || 'PENDING',
    requestId: response.data.request_id,
  };
}

/**
 * Query a HappyHorse task status
 */
async function queryTask(apiKey, taskId) {
  const response = await axios.get(
    `${HAPPYHORSE_BASE_URL}/api/v2/open/aigc/${taskId}`,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  console.log('Query response:', JSON.stringify(response.data, null, 2));

  if (response.data.code !== 0) {
    throw new Error(response.data.msg || 'Query task failed');
  }

  const data = response.data.data || {};
  
  return {
    taskId: data.taskId || taskId,
    status: data.status,
    videoUrl: data.result?.[0],
    errorMessage: data.errorMsg,
    requestId: response.data.request_id,
  };
}

/**
 * Wait for task completion with polling
 */
async function waitForCompletion(apiKey, taskId, maxWaitTime = 300000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const result = await queryTask(apiKey, taskId);

    // HappyHorse task status: processing, success, failed
    if (result.status === 'success' || result.status === 'failed') {
      return result;
    }

    const elapsed = Date.now() - startTime;
    let interval;

    if (elapsed < 30000) {
      interval = 3000;
    } else if (elapsed < 120000) {
      interval = 5000;
    } else {
      interval = 10000;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error('Task timeout: exceeded maximum wait time');
}

/**
 * Upload buffer to OSS
 */
async function uploadToOSS(buffer, filename, folder = 'video') {
  const client = new OSS({
    region: process.env.OSS_REGION,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    endpoint: process.env.OSS_ENDPOINT || `oss-${process.env.OSS_REGION}.aliyuncs.com`,
    secure: true,
    timeout: 300000,
  });

  const objectName = `public/${folder}/${filename}`;
  await client.put(objectName, buffer);

  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;
  const url = `https://${bucket}.oss-${region}.aliyuncs.com/${objectName}`;

  return url;
}

/**
 * Generate video with complete workflow: create + poll + download + upload to OSS
 */
async function generateVideo(apiKey, request) {
  console.log('Starting complete video generation workflow...');
  
  // Step 1: Create task
  const createResult = await createTask(apiKey, request);
  const taskId = createResult.taskId;
  console.log('Task created:', taskId);

  // Step 2: Wait for completion
  console.log('Waiting for task completion...');
  const result = await waitForCompletion(apiKey, taskId);

  if (result.status === 'failed') {
    throw new Error(result.errorMessage || 'Video generation failed');
  }

  if (!result.videoUrl) {
    throw new Error('No video URL in completed task');
  }

  console.log('Video generated, downloading from:', result.videoUrl);

  // Step 3: Download video
  const videoResponse = await axios.get(result.videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });

  if (videoResponse.status !== 200) {
    throw new Error('Failed to download video');
  }

  const videoBuffer = Buffer.from(videoResponse.data);
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;

  // Step 4: Upload to OSS
  console.log('Uploading video to OSS...');
  const ossUrl = await uploadToOSS(videoBuffer, filename);
  console.log('Video uploaded to OSS:', ossUrl);

  return {
    taskId,
    status: result.status,
    videoUrl: ossUrl,
    originalVideoUrl: result.videoUrl,
  };
}

// 阿里云FC HTTP触发器入口
exports.handler = async (event, context) => {
  // 设置CORS响应头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  // 处理OPTIONS预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    let body;
    let httpEvent = event;
    
    // 如果 event 是 Buffer 或类数组对象，先解码
    if (Buffer.isBuffer(event)) {
      const decoded = event.toString('utf-8');
      httpEvent = JSON.parse(decoded);
    } else if (typeof event === 'object' && event !== null && '0' in event) {
      // 类数组对象（FC 传入的 Buffer-like）
      const arr = [];
      for (let i = 0; i in event; i++) {
        arr.push(event[i]);
      }
      const decoded = Buffer.from(arr).toString('utf-8');
      httpEvent = JSON.parse(decoded);
    }
    
    // 标准的 HTTP 触发器参数解析
    if (httpEvent.body) {
      const bodyStr = httpEvent.isBase64Encoded 
        ? Buffer.from(httpEvent.body, 'base64').toString() 
        : httpEvent.body;
      try {
        body = JSON.parse(bodyStr);
      } catch (parseError) {
        body = bodyStr;
      }
    } else {
      body = httpEvent.queryStringParameters || httpEvent;
    }

    const { action } = body;
    const apiKey = process.env.HAPPYHORSE_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: '请配置 HAPPYHORSE_API_KEY 环境变量' })
      };
    }

    switch (action) {
      case 'generate': {
        // Complete workflow: create + poll + download + upload to OSS
        const { prompt, media, resolution, ratio, duration, model } = body;

        if (!prompt) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing prompt' })
          };
        }

        if (!media || !Array.isArray(media) || media.length === 0) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing media array (must contain video or reference_image items)' })
          };
        }

        console.log('Generating HappyHorse video (complete workflow):', { 
          prompt: prompt.substring(0, 100), 
          mediaCount: media.length,
          resolution,
          ratio,
          duration 
        });

        const result = await generateVideo(apiKey, {
          prompt,
          media,
          resolution,
          ratio,
          duration,
          model,
        });

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(result)
        };
      }

      case 'create': {
        const { prompt, media, resolution, ratio, duration, model } = body;

        if (!prompt) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing prompt' })
          };
        }

        if (!media || !Array.isArray(media) || media.length === 0) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing media array (must contain video or reference_image items)' })
          };
        }

        console.log('Creating HappyHorse task:', { 
          prompt: prompt.substring(0, 100), 
          mediaCount: media.length,
          resolution,
          ratio,
          duration 
        });

        const result = await createTask(apiKey, {
          prompt,
          media,
          resolution,
          ratio,
          duration,
          model,
        });

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(result)
        };
      }

      case 'query': {
        const { taskId } = body;

        if (!taskId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing taskId' })
          };
        }

        console.log('Querying HappyHorse task:', taskId);

        const result = await queryTask(apiKey, taskId);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(result)
        };
      }

      case 'wait': {
        const { taskId, maxWaitTime } = body;

        if (!taskId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing taskId' })
          };
        }

        console.log('Waiting for HappyHorse task:', taskId);

        const result = await waitForCompletion(apiKey, taskId, maxWaitTime);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(result)
        };
      }

      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid action. Use "generate", "create", "query", or "wait"' })
        };
    }
  } catch (error) {
    console.error('HappyHorse FC error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message,
        details: error.stack
      })
    };
  }
};
