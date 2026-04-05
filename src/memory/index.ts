/**
 * Memory Subsystem - first-class container.
 * Reference: arc42 Section 5.1, 5.2.2
 *
 * Facade over all 4 memory levels and their components.
 */

import { MemoryAccessControl } from "./access-control.js";
import { SessionDAGManager } from "./session-dag.js";
import { DailyProtocolFlusher } from "./daily-protocol.js";
import { ExpertiseStore } from "./expertise-store.js";
import { KnowledgeGraphLoader } from "./knowledge-graph.js";
import { GitCheckpointEngine } from "./git-checkpoint.js";
import type { MemoryConfig } from "../types.js";

export class MemorySubsystem {
  readonly accessControl: MemoryAccessControl;
  readonly sessionDAG: SessionDAGManager;
  readonly dailyProtocol: DailyProtocolFlusher;
  readonly expertise: ExpertiseStore;
  readonly knowledgeGraph: KnowledgeGraphLoader;
  readonly gitCheckpoint: GitCheckpointEngine;

  constructor(rootDir: string, memoryDir: string, config: MemoryConfig) {
    this.accessControl = new MemoryAccessControl();
    this.sessionDAG = new SessionDAGManager(memoryDir);
    this.dailyProtocol = new DailyProtocolFlusher(memoryDir, config.daily_retention_days);
    this.expertise = new ExpertiseStore(memoryDir, this.accessControl);
    this.knowledgeGraph = new KnowledgeGraphLoader(memoryDir, config.knowledge_graph_token_budget);
    this.gitCheckpoint = new GitCheckpointEngine(rootDir);
  }

  /**
   * Initialize memory directories and defaults.
   */
  initialize(): void {
    this.knowledgeGraph.ensureIndex();
  }
}

export { MemoryAccessControl } from "./access-control.js";
export { SessionDAGManager } from "./session-dag.js";
export { DailyProtocolFlusher } from "./daily-protocol.js";
export { ExpertiseStore } from "./expertise-store.js";
export { KnowledgeGraphLoader } from "./knowledge-graph.js";
export { GitCheckpointEngine } from "./git-checkpoint.js";
