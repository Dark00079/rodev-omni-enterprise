import { InteractiveDashboard } from '../src/server/interactiveDashboard.js';
import { ExecutorSandbox } from '../src/runtime/executorSandbox.js';
import { Workspace3dRenderer } from '../src/renderer/workspace3dRenderer.js';
import { Vector3 } from '../src/runtime/datatypes.js';

async function main() {
  const sandbox = new ExecutorSandbox();
  Workspace3dRenderer.populateTemplate(sandbox.game.Workspace, "baseplate");
  const player = sandbox.game.Players.LocalPlayer.spawnMockCharacter("R6", new Vector3(0, 3, 0));
  player.Parent = sandbox.game.Workspace;

  const res = await InteractiveDashboard.start(
    4050,
    sandbox.game.Workspace,
    {
      cameraMode: "third_person",
      lighting: sandbox.game.Lighting,
      playerModel: player,
      walkCycle: 0,
      template: "baseplate",
      showHud: true
    },
    true, // automatically launch default browser on user machine
    sandbox
  );

  console.log(`[RoDev Interactive Server Online] URL: ${res.url}`);
  console.log(`[RoDev] WASD controls, camera orbit, raycast physics & Developer Console ready.`);
  
  // Keep process alive indefinitely
  setInterval(() => {}, 10000);
}

main().catch((err) => {
  console.error("Dashboard Server Error:", err);
  process.exit(1);
});
