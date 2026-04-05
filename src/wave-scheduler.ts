/**
 * Wave Scheduler - topological sort of tasks into dependency waves.
 * Reference: arc42 Section 6.6 (Wave-Based Parallel Execution)
 *
 * Tasks with no dependencies → wave 1.
 * Tasks depending on wave N tasks → wave N+1.
 */

export interface WaveTask {
  id: string;
  dependencies: string[];
}

export interface WaveAssignment {
  taskId: string;
  wave: number;
}

/**
 * Compute wave assignments via topological sort.
 * Returns tasks sorted into dependency waves.
 * Throws if circular dependencies are detected.
 */
export function computeWaves(tasks: WaveTask[]): WaveAssignment[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const waveMap = new Map<string, number>();
  const visiting = new Set<string>();

  function getWave(taskId: string): number {
    const cached = waveMap.get(taskId);
    if (cached !== undefined) return cached;

    if (visiting.has(taskId)) {
      throw new Error(`Circular dependency detected involving task '${taskId}'`);
    }

    visiting.add(taskId);

    const task = taskMap.get(taskId);
    if (!task || task.dependencies.length === 0) {
      visiting.delete(taskId);
      waveMap.set(taskId, 1);
      return 1;
    }

    let maxDepWave = 0;
    for (const depId of task.dependencies) {
      if (!taskMap.has(depId)) {
        // Dependency on unknown task -- treat as resolved (wave 0)
        continue;
      }
      maxDepWave = Math.max(maxDepWave, getWave(depId));
    }

    const wave = maxDepWave + 1;
    visiting.delete(taskId);
    waveMap.set(taskId, wave);
    return wave;
  }

  for (const task of tasks) {
    getWave(task.id);
  }

  return tasks.map(t => ({
    taskId: t.id,
    wave: waveMap.get(t.id) ?? 1,
  }));
}

/**
 * Group tasks by wave number.
 */
export function groupByWave(assignments: WaveAssignment[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const a of assignments) {
    const list = groups.get(a.wave) ?? [];
    list.push(a.taskId);
    groups.set(a.wave, list);
  }
  return groups;
}
