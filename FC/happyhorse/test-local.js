// 本地测试 FC 函数
require('dotenv').config();
const handler = require('./index.js').handler;

async function test() {
  const event = {
    body: JSON.stringify({
      action: 'create',
      prompt: 'test video',
      genType: 't2v',
      resolution: '720P',
      duration: 5
    }),
    headers: {
      authorization: 'Bearer test-token'
    }
  };

  const context = {
    requestId: 'test-request-id',
    credentials: {}
  };

  try {
    console.log('Testing FC function locally...');
    const result = await handler(event, context);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
