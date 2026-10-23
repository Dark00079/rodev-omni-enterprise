/**
 * High-level sandbox: owns a Luau VM, a DataModel, the object bridge and the
 * task scheduler, and exposes a small surface for running scripts and stepping
 * simulated frames. This is the Luau-backed successor to the fengari-based
 * ExecutorSandbox; it is a disconnected offline emulator (no real Roblox
 * client or network is involved).
 */

import { LuauVM } from './LuauVM.js';
import { ObjectBridge } from './ObjectBridge.js';
import { TaskScheduler } from './TaskScheduler.js';
import { installEnvironment, RobloxEnvironment, EnvLog } from './RobloxEnvironment.js';
import { DataModel, RunService } from '../runtime/services.js';
import { Instance } from '../runtime/instanceEngine.js';

export interface ExecuteResult {
  success: boolean;
  error: string | null;
  logs: EnvLog[];
}

export class LuauSandbox {
  readonly vm: LuauVM;
  readonly game: DataModel;
  readonly bridge: ObjectBridge;
  readonly scheduler: TaskScheduler;
  private readonly env: RobloxEnvironment;
  private readonly runService: RunService;
  private frame = 0;

  private constructor(env: RobloxEnvironment) {
    this.env = env;
    this.vm = env.vm;
    this.game = env.game;
    this.bridge = env.bridge;
    this.scheduler = env.scheduler;
    this.runService = this.game.GetService('RunService') as RunService;
    this.registerYieldingMethods();
  }

  static async create(game?: DataModel): Promise<LuauSandbox> {
    const vm = await LuauVM.create();
    const env = installEnvironment(vm, game ?? new DataModel());
    return new LuauSandbox(env);
  }

  /** Runs a script to completion (draining the scheduler) and returns logs. */
  execute(source: string, chunkName = 'script', budgetMs = 5000): ExecuteResult {
    const logStart = this.env.logs.length;
    const err = this.scheduler.runMain(source, chunkName, budgetMs);
    const logs = this.env.logs.slice(logStart);
    return { success: !err, error: err, logs };
  }

  /**
   * Advances one simulated frame: fires RunService Stepped/Heartbeat/
   * RenderStepped and resumes any threads whose deadline has passed.
   */
  step(dt = 1 / 60): void {
    const t = this.scheduler.clock;
    this.safeFire(this.runService.Stepped, t, dt);
    this.scheduler.step(dt);
    this.safeFire(this.runService.Heartbeat, dt);
    this.safeFire(this.runService.RenderStepped, dt);
    this.frame++;
  }

  /** Runs `frames` simulated frames at the given timestep. */
  stepFrames(frames: number, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) this.step(dt);
  }

  get logs(): EnvLog[] { return this.env.logs; }
  get frameCount(): number { return this.frame; }

  reset(): void {
    this.scheduler.reset();
    this.env.logs.length = 0;
    this.frame = 0;
  }

  close(): void {
    this.scheduler.reset();
    this.vm.close();
  }

  // Firing a Roblox signal re-enters Lua via wrapped handlers; isolate faults
  // so one bad listener cannot abort the frame.
  private safeFire(signal: { Fire: (...a: any[]) => void }, ...args: any[]): void {
    try {
      signal.Fire(...args);
    } catch (err: any) {
      this.env.logs.push({ level: 'error', text: err?.message ?? String(err) });
    }
  }

  private registerYieldingMethods(): void {
    const bridge = this.bridge;
    const scheduler = this.scheduler;

    // Instance:WaitForChild(name, timeout?) -> yields until the child exists.
    bridge.registerYielding('WaitForChild', (vm, self, args) => {
      if (!(self instanceof Instance)) throw new Error('WaitForChild requires an Instance');
      const name = String(args[0]);
      const timeout = typeof args[1] === 'number' ? args[1] : undefined;

      const existing = self.FindFirstChild(name);
      if (existing) { bridge.marshalInto(vm, existing); return 1; }

      scheduler.yieldCondition(vm, (resolve) => {
        const conn = self.ChildAdded.Connect((child: Instance) => {
          if (child.Name === name) {
            resolve((t) => { bridge.marshalInto(t, child); return 1; });
          }
        });
        return () => conn.Disconnect();
      }, timeout, (t) => { t.pushNil(); return 1; });
    });
  }
}
