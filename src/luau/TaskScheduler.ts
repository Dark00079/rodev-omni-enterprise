/**
 * Coroutine-based task scheduler with a virtual clock. Scripts run on Lua
 * threads so task.wait yields authentically; the scheduler resumes them when
 * their simulated deadline passes. RunService Heartbeat/Stepped/RenderStepped
 * fire once per stepped frame.
 *
 * Time is virtual: nothing sleeps in wall-clock. step(dt) advances the clock by
 * dt and runs everything that became due, so tests are deterministic and fast.
 */

import { LuauVM, CoStatus } from './LuauVM.js';
import { ObjectBridge } from './ObjectBridge.js';

interface WaitingThread {
  thread: LuauVM;
  resumeAt: number;
  startedAt: number;
  isMain: boolean;
}

interface Timer { at: number; fn: () => void; cancelled: boolean; }

export class TaskScheduler {
  public clock = 0;
  private waiting: WaitingThread[] = [];
  private deferred: Array<() => void> = [];
  private timers: Timer[] = [];
  private liveThreads = new Set<LuauVM>();
  public lastError: string | null = null;

  constructor(
    private readonly main: LuauVM,
    private readonly bridge: ObjectBridge,
    private readonly onError: (msg: string) => void,
  ) {}

  /** task.wait(t): suspend the running thread until clock + max(t, 0). */
  wait(thread: LuauVM, duration: number): never {
    const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.waiting.push({ thread, resumeAt: this.clock + d, startedAt: this.clock, isMain: false });
    thread.prepareYield(0);
  }

  /** task.spawn(fn, ...): run immediately on a fresh thread. Returns the thread. */
  spawnFromStack(caller: LuauVM): LuauVM {
    const n = caller.getTop();
    const thread = caller.newThread();
    this.liveThreads.add(thread);
    for (let i = 1; i <= n; i++) caller.pushValue(i);
    caller.xmoveTo(thread, n); // [fn, arg1..arg(n-1)] now on the thread
    this.resumeThread(thread, n - 1, null);
    return thread;
  }

  /** task.defer(fn, ...): run on a fresh thread at the end of the cycle. */
  deferFromStack(caller: LuauVM): LuauVM {
    const n = caller.getTop();
    const thread = caller.newThread();
    this.liveThreads.add(thread);
    for (let i = 1; i <= n; i++) caller.pushValue(i);
    caller.xmoveTo(thread, n);
    this.deferred.push(() => this.resumeThread(thread, n - 1, null));
    return thread;
  }

  /** task.delay(t, fn, ...): run on a fresh thread after t simulated seconds. */
  delayFromStack(caller: LuauVM, delay: number): LuauVM {
    const n = caller.getTop();
    const thread = caller.newThread();
    this.liveThreads.add(thread);
    // Drop arg 1 (the delay) from the moved values: push fn + rest (indices 2..n).
    for (let i = 2; i <= n; i++) caller.pushValue(i);
    caller.xmoveTo(thread, n - 1);
    const d = Number.isFinite(delay) && delay > 0 ? delay : 0;
    this.waiting.push({ thread, resumeAt: this.clock + d, startedAt: this.clock, isMain: false });
    // When it fires, resume with its (n-2) args already on the thread stack.
    (thread as any)._pendingArgs = n - 2;
    return thread;
  }

  /** Schedules `fn` to run after `delay` simulated seconds; returns a canceller. */
  addTimer(delay: number, fn: () => void): () => void {
    const timer: Timer = { at: this.clock + Math.max(0, delay || 0), fn, cancelled: false };
    this.timers.push(timer);
    return () => { timer.cancelled = true; };
  }

  /**
   * Parks `thread` until an external event resolves it. `setup(resolve)` wires
   * up the event source and returns an optional cleanup; calling `resolve(push)`
   * resumes the thread (push, run on the thread, returns the number of results).
   * An optional timeout resolves with no results when it elapses first.
   */
  yieldCondition(
    thread: LuauVM,
    setup: (resolve: (push?: (vm: LuauVM) => number) => void) => (() => void) | void,
    timeoutSec?: number,
    onTimeout?: (vm: LuauVM) => number,
  ): never {
    let settled = false;
    let cleanup: (() => void) | void;
    let cancelTimer: (() => void) | undefined;
    const resolve = (push?: (vm: LuauVM) => number) => {
      if (settled) return;
      settled = true;
      if (cleanup) cleanup();
      if (cancelTimer) cancelTimer();
      this.deferred.push(() => {
        const n = push ? push(thread) : 0;
        this.resumeThread(thread, n, null);
      });
    };
    cleanup = setup(resolve);
    if (timeoutSec !== undefined && timeoutSec > 0 && Number.isFinite(timeoutSec)) {
      cancelTimer = this.addTimer(timeoutSec, () => resolve(onTimeout));
    }
    thread.prepareYield(0);
  }

  /** Runs `source` as the main script on its own thread; drains the scheduler. */
  runMain(source: string, chunkName: string, budgetMs = 5000): string | null {
    this.main.setExecutionBudget(budgetMs);
    const loadErr = this.main.load(source, chunkName);
    if (loadErr) { this.main.clearExecutionBudget(); return loadErr; }

    const thread = this.main.newThread();
    this.liveThreads.add(thread);
    this.main.xmoveTo(thread, 1); // move the loaded chunk onto the thread
    this.resumeThread(thread, 0, null);
    this.drain(budgetMs);
    this.main.clearExecutionBudget();
    return this.lastError;
  }

  /** Advances the virtual clock by dt and resumes everything now due. */
  step(dt: number): void {
    this.clock += dt;
    this.runDue();
    this.runDeferred();
  }

  /** Resumes due threads until the scheduler is quiescent or time runs out. */
  drain(budgetMs: number): void {
    const deadline = Date.now() + budgetMs;
    let guard = 0;
    while (this.pendingCount > 0 && Date.now() < deadline) {
      this.runDeferred();
      const deadlines = [
        ...this.waiting.map((w) => w.resumeAt),
        ...this.timers.filter((t) => !t.cancelled).map((t) => t.at),
      ];
      if (deadlines.length === 0) break;
      // Advance virtual time to the next pending deadline.
      this.clock = Math.max(this.clock, Math.min(...deadlines));
      this.runDue();
      if (++guard > 1_000_000) break;
    }
  }

  private runDue(): void {
    // Fire due timers first (WaitForChild timeouts, task.delay fallbacks).
    const dueTimers = this.timers.filter((t) => !t.cancelled && t.at <= this.clock + 1e-9);
    this.timers = this.timers.filter((t) => !t.cancelled && t.at > this.clock + 1e-9);
    for (const t of dueTimers) t.fn();

    const due = this.waiting.filter((w) => w.resumeAt <= this.clock + 1e-9);
    this.waiting = this.waiting.filter((w) => w.resumeAt > this.clock + 1e-9);
    for (const w of due) {
      const pending = (w.thread as any)._pendingArgs;
      if (pending !== undefined) {
        (w.thread as any)._pendingArgs = undefined;
        this.resumeThread(w.thread, pending, null);
      } else {
        // task.wait returns the elapsed time.
        w.thread.pushNumber(this.clock - w.startedAt);
        this.resumeThread(w.thread, 1, w);
      }
    }
  }

  private runDeferred(): void {
    while (this.deferred.length > 0) {
      const batch = this.deferred;
      this.deferred = [];
      for (const fn of batch) fn();
    }
  }

  private resumeThread(thread: LuauVM, nargs: number, _ctx: WaitingThread | null): void {
    const status = thread.resume(this.main, nargs);
    if (thread.isStatusOk(status)) {
      this.retire(thread);
    } else if (thread.isStatusYield(status)) {
      // Thread parked itself via task.wait; it is already queued.
    } else {
      const err = thread.toString(-1);
      this.lastError = err;
      this.onError(err);
      this.retire(thread);
    }
  }

  private retire(thread: LuauVM): void {
    if (this.liveThreads.has(thread)) {
      this.liveThreads.delete(thread);
      this.main.releaseThread(thread);
    }
  }

  reset(): void {
    this.clock = 0;
    this.waiting = [];
    this.deferred = [];
    this.timers = [];
    this.lastError = null;
    for (const t of this.liveThreads) this.main.releaseThread(t);
    this.liveThreads.clear();
  }

  get pendingCount(): number {
    return this.waiting.length + this.deferred.length + this.timers.filter((t) => !t.cancelled).length;
  }
}
