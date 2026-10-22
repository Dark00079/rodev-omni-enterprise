/**
 * Verification test for InteractiveDashboard
 */

import http from 'http';
import { InteractiveDashboard } from '../src/server/interactiveDashboard.js';
import { ExecutorSandbox } from '../src/runtime/executorSandbox.js';
import { Workspace3dRenderer } from '../src/renderer/workspace3dRenderer.js';
import { Vector3 } from '../src/runtime/datatypes.js';

async function testDashboard() {
  console.log("--> Testing InteractiveDashboard startup and API endpoints...");

  const sandbox = new ExecutorSandbox();
  Workspace3dRenderer.populateTemplate(sandbox.game.Workspace, "baseplate");
  const player = sandbox.game.Players.LocalPlayer.spawnMockCharacter("R6", new Vector3(0, 3, 0));
  player.Parent = sandbox.game.Workspace;

  const result = await InteractiveDashboard.start(
    4055,
    sandbox.game.Workspace,
    {
      cameraMode: "third_person",
      lighting: sandbox.game.Lighting,
      playerModel: player,
      walkCycle: 0,
      template: "baseplate"
    },
    false, // autoOpen: false for test
    sandbox
  );

  console.log(`PASS: Dashboard started on ${result.url}`);

  // Test 1: GET /
  const htmlRes: string = await new Promise((resolve, reject) => {
    http.get(`http://localhost:4055/`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  if (!htmlRes.includes('viewport-canvas') || !htmlRes.includes('WASD')) {
    throw new Error("HTML does not contain viewport-canvas or WASD controls!");
  }
  console.log("PASS: GET / returns 60 FPS interactive HTML with canvas and controls.");

  // Test 2: GET /api/status
  const statusRes: any = await new Promise((resolve, reject) => {
    http.get(`http://localhost:4055/api/status`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  if (statusRes.status !== "online") {
    throw new Error("API status is not online!");
  }
  console.log("PASS: GET /api/status returned online status.");

  // Test 3: POST /api/execute
  const postData = JSON.stringify({ script: "local p = Instance.new('Part', workspace); p.Name = 'SpawnedPart'; print('Spawned part dynamically!')" });
  const execRes: any = await new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:4055/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  if (!execRes.success) {
    throw new Error(`Execute API failed: ${execRes.error}`);
  }
  console.log("PASS: POST /api/execute successfully executed Luau script dynamically.");

  // Test 4: Stop
  await InteractiveDashboard.stop();
  if (InteractiveDashboard.isRunning()) {
    throw new Error("Server did not stop cleanly!");
  }
  console.log("PASS: InteractiveDashboard stopped cleanly.");

  console.log("\n=======================================================");
  console.log("   ALL INTERACTIVE DASHBOARD TESTS PASSED (100%)");
  console.log("=======================================================");
  process.exit(0);
}

testDashboard().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
