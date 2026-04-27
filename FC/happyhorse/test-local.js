// 本地测试 FC 函数 - DashScope API
require('dotenv').config();
const handler = require('./index.js').handler;

async function testCreate() {
  console.log('\n=== Test 1: Create task with reference images ===');
  const event = {
    body: JSON.stringify({
      action: 'create',
      prompt: '身着红色旗袍的女性，镜头先以侧面中景勾勒旗袍修身剪裁与S型曲线',
      media: [
        {
          type: 'reference_image',
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/mvzfud/hh-v2v-girl.jpg'
        },
        {
          type: 'reference_image',
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/fvuihk/hh-v2v2-folding-fan.jpg'
        }
      ],
      resolution: '720P',
      ratio: '16:9',
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
    const result = await handler(event, context);
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.statusCode === 200) {
      const body = JSON.parse(result.body);
      return body.taskId;
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

async function testQuery(taskId) {
  console.log('\n=== Test 2: Query task status ===');
  const event = {
    body: JSON.stringify({
      action: 'query',
      taskId: taskId
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
    const result = await handler(event, context);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

async function testVideoEdit() {
  console.log('\n=== Test 3: Create task with video and reference image ===');
  const event = {
    body: JSON.stringify({
      action: 'create',
      prompt: '将视频中的人物服装替换为红色旗袍',
      media: [
        {
          type: 'video',
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260409/dozxak/Wan_Video_Edit_33_1.mp4'
        },
        {
          type: 'reference_image',
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260415/hynnff/wan-video-edit-clothes.webp'
        }
      ],
      resolution: '720P',
      ratio: '16:9',
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
    const result = await handler(event, context);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

async function testGenerate() {
  console.log('\n=== Test 4: Generate video (complete workflow) ===');
  const event = {
    body: JSON.stringify({
      action: 'generate',
      prompt: '身着红色旗袍的女性，镜头先以侧面中景勾勒旗袍修身剪裁与S型曲线',
      media: [
        {
          type: 'reference_image',
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/mvzfud/hh-v2v-girl.jpg'
        },
        {
          type: 'reference_image',
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/fvuihk/hh-v2v2-folding-fan.jpg'
        }
      ],
      resolution: '720P',
      ratio: '16:9',
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
    console.log('Starting complete video generation workflow...');
    const result = await handler(event, context);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

async function runTests() {
  // Uncomment the test you want to run:
  
  // Test 1: Create with reference images
  // const taskId = await testCreate();
  
  // Test 2: Query task status
  // if (taskId) {
  //   await new Promise(resolve => setTimeout(resolve, 2000));
  //   await testQuery(taskId);
  // }
  
  // Test 3: Video editing
  // await testVideoEdit();
  
  // Test 4: Complete workflow (generate)
  await testGenerate();
}

runTests();
