/**
 * Test script for HappyHorse FC integration
 * 
 * Usage:
 *   tsx src/lib/services/__test-happyhorse.ts
 */

import "dotenv/config";
import {
  callFcHappyHorseCreate,
  callFcHappyHorseQuery,
  callFcHappyHorseWait,
} from "./fc-happyhorse-client";

async function testHappyHorse() {
  console.log("=== HappyHorse FC Integration Test ===\n");

  // Test 1: Text-to-Video
  console.log("Test 1: Creating text-to-video task...");
  try {
    const t2vTask = await callFcHappyHorseCreate({
      prompt: "一个小女孩在花园里奔跑，阳光明媚",
      genType: "t2v",
      resolution: "720P",
      ratio: "16:9",
      duration: 5,
    });
    console.log("✓ T2V Task created:", t2vTask);
    console.log(`  Task ID: ${t2vTask.taskId}`);
    console.log(`  Status: ${t2vTask.status}\n`);

    // Query the task
    console.log("Querying task status...");
    const queryResult = await callFcHappyHorseQuery(t2vTask.taskId);
    console.log("✓ Query result:", queryResult);
    console.log(`  Status: ${queryResult.status}\n`);
  } catch (error) {
    console.error("✗ T2V test failed:", error);
  }

  // Test 2: Image-to-Video (requires image URL)
  console.log("\nTest 2: Creating image-to-video task...");
  console.log("Note: This test requires valid image URLs. Skipping for now.");
  console.log("Example usage:");
  console.log(`
  const i2vTask = await callFcHappyHorseCreate({
    prompt: "让图片中的场景动起来，微风吹拂",
    genType: "i2v",
    imageUrls: [
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg"
    ],
    resolution: "1080P",
    duration: 5,
  });
  `);

  // Test 3: Wait for completion (commented out to avoid long wait)
  console.log("\nTest 3: Wait for task completion");
  console.log("Note: This would wait for the task to complete. Skipping for now.");
  console.log("Example usage:");
  console.log(`
  const result = await callFcHappyHorseWait(taskId, {
    maxWaitTime: 300000, // 5 minutes
    onProgress: (status) => console.log("Status:", status),
  });
  console.log("Video URL:", result.result?.[0]);
  `);

  console.log("\n=== Test Complete ===");
}

// Run tests
testHappyHorse().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
