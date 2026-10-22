/**
 * Memory Leak, Signal Connection & Task Lifecycle Profiler
 * Monitors signal connections, task scheduler threads, instance allocations,
 * and detects orphaned memory leaks between lifecycle snapshots.
 */
export class MemoryProfiler {
    activeConnections = new Map();
    trackedInstances = new Map();
    activeTasks = new Set();
    snapshots = new Map();
    registerConnection(conn, stack) {
        this.activeConnections.set(conn.id, { conn, stack });
    }
    unregisterConnection(id) {
        this.activeConnections.delete(id);
    }
    registerInstance(inst) {
        this.trackedInstances.set(inst.UniqueId, inst);
    }
    unregisterInstance(uniqueId) {
        this.trackedInstances.delete(uniqueId);
    }
    registerTask(taskId) {
        this.activeTasks.add(taskId);
    }
    unregisterTask(taskId) {
        this.activeTasks.delete(taskId);
    }
    /**
     * Take a snapshot of the current allocation state
     */
    takeSnapshot(name) {
        const connMap = new Map();
        for (const [id, entry] of this.activeConnections.entries()) {
            if (entry.conn.Connected) {
                connMap.set(id, {
                    signalName: entry.conn.signalName,
                    instancePath: entry.conn.instance.FullPath,
                    stack: entry.stack
                });
            }
        }
        const instSet = new Set();
        for (const [id, inst] of this.trackedInstances.entries()) {
            instSet.add(id);
        }
        const snapshot = {
            name,
            timestamp: Date.now(),
            connections: connMap,
            instances: instSet,
            tasksCount: this.activeTasks.size
        };
        this.snapshots.set(name, snapshot);
        return snapshot;
    }
    /**
     * Compare two snapshots to detect leaks created between baseline and end
     */
    diffSnapshots(beforeName, afterName) {
        const before = this.snapshots.get(beforeName);
        const after = this.snapshots.get(afterName);
        if (!before || !after) {
            throw new Error(`Snapshot '${!before ? beforeName : afterName}' does not exist.`);
        }
        const leakedConnections = [];
        for (const [id, record] of after.connections.entries()) {
            if (!before.connections.has(id)) {
                // Leaked connection created after baseline
                leakedConnections.push({
                    id,
                    signalName: record.signalName,
                    instancePath: record.instancePath,
                    stack: record.stack
                });
            }
        }
        const leakedInstances = [];
        for (const instId of after.instances) {
            if (!before.instances.has(instId)) {
                const inst = this.trackedInstances.get(instId);
                if (inst) {
                    leakedInstances.push({
                        uniqueId: instId,
                        className: inst.ClassName,
                        name: inst.Name,
                        parentPath: inst.Parent ? inst.Parent.FullPath : null
                    });
                }
            }
        }
        const leakedTasksCount = Math.max(0, after.tasksCount - before.tasksCount);
        const detectedLeaks = leakedConnections.length > 0 || leakedInstances.length > 0 || leakedTasksCount > 0;
        const recommendations = [];
        if (leakedConnections.length > 0) {
            recommendations.push("Store connection tokens in a table or Janitor/Maid structure and invoke `:Disconnect()` on feature toggle/unloader.");
        }
        if (leakedInstances.length > 0) {
            recommendations.push("Call `:Destroy()` on all GUI frames, highlights, and 3D parts when tearing down the UI/feature to free C++ memory.");
        }
        const summary = detectedLeaks
            ? `Memory leak detected! Leaked ${leakedConnections.length} connection(s), ${leakedInstances.length} instance(s), and ${leakedTasksCount} task(s).`
            : "Zero leaks detected. All connections disconnected and instances cleanly reclaimed.";
        return {
            detectedLeaks,
            leakedConnectionsCount: leakedConnections.length,
            leakedInstancesCount: leakedInstances.length,
            leakedTasksCount,
            leakedConnections,
            leakedInstances,
            summary,
            recommendations
        };
    }
    reset() {
        this.activeConnections.clear();
        this.trackedInstances.clear();
        this.activeTasks.clear();
        this.snapshots.clear();
    }
}
export const GlobalProfiler = new MemoryProfiler();
