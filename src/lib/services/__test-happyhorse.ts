/**
 * Test script for HappyHorse FC integration
 * 
 * Usage:
 *   tsx src/lib/services/__test-happyhorse.ts <source-video-url> [reference-image-url...]
 */

import "dotenv/config";
import {
  callFcHappyHorseCreate,
  callFcHappyHorseQuery,
  callFcHappyHorseWait,
  type MediaItem,
} from "./fc-happyhorse-client";

function buildMedia(
  sourceVideoUrl: string,
  referenceImageUrls: string[],
): MediaItem[] {
  return [
    { type: "video", url: sourceVideoUrl },
    ...referenceImageUrls.map((url): MediaItem => ({
      type: "reference_image",
      url,
    })),
  ];
}

async function testHappyHorse() {
  console.log("=== HappyHorse FC Integration Test ===\n");

  const sourceVideoUrl = process.argv[2];
  const referenceImageUrls = process.argv.slice(3);

  if (!sourceVideoUrl) {
    console.log("Usage:");
    console.log(
      "  tsx src/lib/services/__test-happyhorse.ts <source-video-url> [reference-image-url...]",
    );
    console.log("\nNo source video URL provided. Skipping live FC create/query test.");
    return;
  }

  // Test 1: Video editing with optional reference images
  console.log("Test 1: Creating video generation task...");
  try {
    const task = await callFcHappyHorseCreate({
      prompt: "一个小女孩在花园里奔跑，阳光明媚",
      media: buildMedia(sourceVideoUrl, referenceImageUrls),
      resolution: "720P",
      ratio: "16:9",
      duration: 5,
    });
    console.log("✓ Task created:", task);
    console.log(`  Task ID: ${task.taskId}`);
    console.log(`  Status: ${task.status}\n`);

    // Query the task
    console.log("Querying task status...");
    const queryResult = await callFcHappyHorseQuery(task.taskId);
    console.log("✓ Query result:", queryResult);
    console.log(`  Status: ${queryResult.status}\n`);
  } catch (error) {
    console.error("✗ Create/query test failed:", error);
  }

  // Test 2: Reference image example
  console.log("\nTest 2: Creating task with reference images");
  console.log("Example usage:");
  console.log(`
  const taskWithReference = await callFcHappyHorseCreate({
    prompt: "让图片中的场景动起来，微风吹拂",
    media: [
      { type: "video", url: "https://example.com/source.mp4" },
      { type: "reference_image", url: "https://example.com/image1.jpg" },
      { type: "reference_image", url: "https://example.com/image2.jpg" }
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
  console.log("Video URL:", result.videoUrl);
  `);

  console.log("\n=== Test Complete ===");
}

// Run tests
testHappyHorse().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
