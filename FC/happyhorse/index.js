const axios = require('axios');

/**
 * HappyHorse Video Generation FC Wrapper
 * Wraps HappyHorse API for Function Compute deployment
 */

const HAPPYHORSE_BASE_URL = 'https://mm-internal-cn.leonecloud.com';

/**
 * Create a HappyHorse video generation task
 */
async function createTask(apiKey, request) {
  const response = await axios.post(
    `${HAPPYHORSE_BASE_URL}/api/v2/open/aigc/hh`,
    request,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  if (response.data.code !== 0) {
    throw new Error(response.data.msg || 'Create task failed');
  }

  return {
    taskId: response.data.data.taskId,
    status: response.data.data.status,
    createdAt: response.data.data.createdAt,
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

  if (response.data.code !== 0) {
    throw new Error(response.data.msg || 'Query task failed');
  }

  return {
    taskId: response.data.data.taskId,
    status: response.data.data.status,
    result: response.data.data.result,
    errorMsg: response.data.data.errorMsg,
    createdAt: response.data.data.createdAt,
    updatedAt: response.data.data.updatedAt,
  };
}

/**
 * Wait for task completion with polling
 */
async function waitForCompletion(apiKey, taskId, maxWaitTime = 300000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const result = await queryTask(apiKey, taskId);

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
      case 'create': {
        const { prompt, genType, imageUrls, resolution, ratio, duration, seed, watermark } = body;

        if (!prompt) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing prompt' })
          };
        }

        console.log('Creating HappyHorse task:', { prompt, genType, imageUrlsCount: imageUrls?.length });

        const result = await createTask(apiKey, {
          prompt,
          genType,
          imageUrls,
          resolution,
          ratio,
          duration,
          seed,
          watermark,
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
          body: JSON.stringify({ error: 'Invalid action. Use "create", "query", or "wait"' })
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
