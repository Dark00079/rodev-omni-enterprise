/**
 * Automated Verification Battery for Roblox 3D World & Player Simulation Engine
 * Generates and validates screenshots for:
 * 1. Third-Person View (Roblox Baseplate + Avatar standing on SpawnLocation)
 * 2. First-Person / Player View (Looking from character eyes towards obstacles)
 * 3. Overhead Drone View (High-angle view of the Baseplate, Avatar, and platforms)
 * 4. Custom Angle with Raycast Beams (Visual physics trajectories and hit detection)
 */

import fs from 'fs';
import path from 'path';
import { ExecutorSandbox } from '../src/runtime/executorSandbox.js';
import { Workspace3dRenderer } from '../src/renderer/workspace3dRenderer.js';
import { PlaywrightEngine } from '../src/renderer/playwrightEngine.js';
import { Vector3 } from '../src/runtime/datatypes.js';

function assert(condition: boolean, testName: string, details?: any) {
  if (!condition) {
    console.error(`\x1b[31mFAIL: ${testName}\x1b[0m`, details ?? '');
    process.exit(1);
  }
  console.log(`\x1b[32mPASS: ${testName}\x1b[0m`);
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("  ROBLOX 3D WORLD, ENVIRONMENT & PLAYER SIMULATION TEST SUITE    ");
  console.log("==================================================================");

  const artifactsDir = path.resolve('test/artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const sandbox = new ExecutorSandbox();

  // -----------------------------------------------------------------
  // TEST 1: Third-Person Follow View (Roblox Baseplate + Avatar from behind)
  // -----------------------------------------------------------------
  console.log("\n--> Running Test 1: Third-Person View (Roblox Baseplate + Avatar)...");
  sandbox.reset();
  Workspace3dRenderer.populateTemplate(sandbox.game.Workspace, "baseplate");

  const playerModel1 = sandbox.game.Players.LocalPlayer.spawnMockCharacter("R6", new Vector3(0, 3, 0));
  playerModel1.Parent = sandbox.game.Workspace;

  const html1 = Workspace3dRenderer.generateHtml(sandbox.game.Workspace, {
    cameraMode: "third_person",
    lighting: sandbox.game.Lighting,
    playerModel: playerModel1,
    template: "baseplate"
  });

  const outPath1 = path.join(artifactsDir, "3d_third_person_baseplate.png");
  const res1 = await PlaywrightEngine.renderAndDiagnose(html1, "desktop_1080p", outPath1);

  assert(fs.existsSync(outPath1), "Test 1: 3d_third_person_baseplate.png written to disk");
  assert(res1.base64Png.length > 20000, "Test 1: Output PNG has substantial image data (>20KB)");
  console.log(`    Generated: ${outPath1} (${Math.round(res1.base64Png.length / 1024)} KB)`);

  // -----------------------------------------------------------------
  // TEST 1b: Front-Facing Avatar Portrait (Showing Classic Smile Face Decal)
  // -----------------------------------------------------------------
  console.log("\n--> Running Test 1b: Front-Facing Avatar Portrait...");
  const html1b = Workspace3dRenderer.generateHtml(sandbox.game.Workspace, {
    cameraMode: "custom",
    cameraPosition: [0, 4.2, -6.5],
    cameraLookAt: [0, 3.8, 0],
    lighting: sandbox.game.Lighting,
    playerModel: playerModel1,
    template: "baseplate"
  });

  const outPath1b = path.join(artifactsDir, "3d_avatar_front_portrait.png");
  const res1b = await PlaywrightEngine.renderAndDiagnose(html1b, "desktop_1080p", outPath1b);

  assert(fs.existsSync(outPath1b), "Test 1b: 3d_avatar_front_portrait.png written to disk");
  console.log(`    Generated: ${outPath1b} (${Math.round(res1b.base64Png.length / 1024)} KB)`);

  // -----------------------------------------------------------------
  // TEST 2: First-Person Player View (Looking from Avatar's Eyes)
  // -----------------------------------------------------------------
  console.log("\n--> Running Test 2: First-Person Player View (Obstacle Course)...");
  sandbox.reset();
  Workspace3dRenderer.populateTemplate(sandbox.game.Workspace, "obstacles");

  const playerModel2 = sandbox.game.Players.LocalPlayer.spawnMockCharacter("R6", new Vector3(0, 3, 0));
  playerModel2.Parent = sandbox.game.Workspace;

  const html2 = Workspace3dRenderer.generateHtml(sandbox.game.Workspace, {
    cameraMode: "first_person",
    lighting: sandbox.game.Lighting,
    playerModel: playerModel2,
    template: "obstacles"
  });

  const outPath2 = path.join(artifactsDir, "3d_first_person_player_view.png");
  const res2 = await PlaywrightEngine.renderAndDiagnose(html2, "desktop_1080p", outPath2);

  assert(fs.existsSync(outPath2), "Test 2: 3d_first_person_player_view.png written to disk");
  assert(res2.base64Png.length > 20000, "Test 2: Output PNG has substantial image data (>20KB)");
  console.log(`    Generated: ${outPath2} (${Math.round(res2.base64Png.length / 1024)} KB)`);

  // -----------------------------------------------------------------
  // TEST 3: Overhead Drone View (High-Angle Environment Screenshot)
  // -----------------------------------------------------------------
  console.log("\n--> Running Test 3: Overhead Drone View...");
  sandbox.reset();
  Workspace3dRenderer.populateTemplate(sandbox.game.Workspace, "obstacles");

  const playerModel3 = sandbox.game.Players.LocalPlayer.spawnMockCharacter("R6", new Vector3(0, 3, 0));
  playerModel3.Parent = sandbox.game.Workspace;

  // Simulate movement towards platform
  const walkCycle = Workspace3dRenderer.stepPlayerMovement(
    playerModel3,
    { moveTo: [0, 3, -12], speed: 16 },
    0.8
  );

  const html3 = Workspace3dRenderer.generateHtml(sandbox.game.Workspace, {
    cameraMode: "overhead",
    lighting: sandbox.game.Lighting,
    playerModel: playerModel3,
    walkCycle,
    template: "obstacles"
  });

  const outPath3 = path.join(artifactsDir, "3d_overhead_drone_view.png");
  const res3 = await PlaywrightEngine.renderAndDiagnose(html3, "desktop_1080p", outPath3);

  assert(fs.existsSync(outPath3), "Test 3: 3d_overhead_drone_view.png written to disk");
  assert(res3.base64Png.length > 20000, "Test 3: Output PNG has substantial image data (>20KB)");
  console.log(`    Generated: ${outPath3} (${Math.round(res3.base64Png.length / 1024)} KB)`);

  // -----------------------------------------------------------------
  // TEST 4: Custom Angle with Raycast Physics & Beams
  // -----------------------------------------------------------------
  console.log("\n--> Running Test 4: Custom Angle with Raycast Physics...");
  sandbox.reset();
  Workspace3dRenderer.populateTemplate(sandbox.game.Workspace, "obstacles");

  const playerModel4 = sandbox.game.Players.LocalPlayer.spawnMockCharacter("R6", new Vector3(-8, 3, 0));
  playerModel4.Parent = sandbox.game.Workspace;

  // Perform Raycasts from character towards platforms
  const hrp = playerModel4.PrimaryPart!;
  const rayOrigin = new Vector3(hrp.Position.X, hrp.Position.Y + 1.5, hrp.Position.Z);
  const rayTarget = new Vector3(0, 3, -16);
  const rayDir = rayTarget.sub(rayOrigin).Unit.mul(30);

  sandbox.game.Workspace.Raycast(rayOrigin, rayDir);
  sandbox.game.Workspace.Raycast(rayOrigin, new Vector3(0, 20, 0)); // Sky miss

  assert(sandbox.game.Workspace.raycastHistory.length === 2, "Test 4: 2 Raycast queries recorded");
  assert(sandbox.game.Workspace.raycastHistory[0].hit === true, "Test 4: Raycast 1 hit platform");

  const html4 = Workspace3dRenderer.generateHtml(sandbox.game.Workspace, {
    cameraMode: "custom",
    cameraPosition: [-16, 12, 14],
    cameraLookAt: [0, 3, -10],
    lighting: sandbox.game.Lighting,
    playerModel: playerModel4,
    template: "obstacles"
  });

  const outPath4 = path.join(artifactsDir, "3d_custom_angle_raycast.png");
  const res4 = await PlaywrightEngine.renderAndDiagnose(html4, "desktop_1080p", outPath4);

  assert(fs.existsSync(outPath4), "Test 4: 3d_custom_angle_raycast.png written to disk");
  assert(res4.base64Png.length > 20000, "Test 4: Output PNG has substantial image data (>20KB)");
  console.log(`    Generated: ${outPath4} (${Math.round(res4.base64Png.length / 1024)} KB)`);

  await PlaywrightEngine.close();

  console.log("\n==================================================================");
  console.log("  ALL 4 ROBLOX 3D WORLD SIMULATION TESTS PASSED CLEANLY!         ");
  console.log("==================================================================");
}

runTestSuite().catch((err) => {
  console.error("Test Suite Error:", err);
  process.exit(1);
});
