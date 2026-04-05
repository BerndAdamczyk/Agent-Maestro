/**
 * Core types and Zod schemas for Agent Maestro.
 * Reference: arc42 Section 5.3 (Code Level)
 */

import { z } from "zod";

// ── Schema version for all file formats ──────────────────────────────

export const SCHEMA_VERSION = 1;

// ── Agent Frontmatter Schema (agents/*.md YAML header) ──────────────

export const ToolPermissionsSchema = z.object({
  read: z.boolean().default(true),
  write: z.boolean().default(true),
  bash: z.boolean().default(true),
  edit: z.boolean().default(true),
  delegate: z.boolean().default(false),
  update_memory: z.boolean().default(false),
  query_notebooklm: z.boolean().default(false),
});

export const MemoryPermissionsSchema = z.object({
  write_levels: z.array(z.number().int().min(1).max(4)).default([1, 2]),
  domain_lock: z.string().nullable().default(null),
});

export const DomainRestrictionsSchema = z.object({
  read: z.array(z.string()).default(["**/*"]),
  upsert: z.array(z.string()).default(["workspace/**"]),
  delete: z.array(z.string()).default([]),
});

export const ModelTierSchema = z.enum(["curator", "lead", "worker"]);

export const AgentFrontmatterSchema = z.object({
  schema_version: z.number().int().default(SCHEMA_VERSION),
  name: z.string().min(1),
  model: z.string().min(1),
  model_tier: ModelTierSchema,
  expertise: z.string().min(1),
  skills: z.array(z.string()).default([]),
  tools: ToolPermissionsSchema,
  memory: MemoryPermissionsSchema.default({}),
  domain: DomainRestrictionsSchema.default({}),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
export type MemoryPermissions = z.infer<typeof MemoryPermissionsSchema>;
export type DomainRestrictions = z.infer<typeof DomainRestrictionsSchema>;
export type ModelTier = z.infer<typeof ModelTierSchema>;

// ── Agent Definition (frontmatter + body) ────────────────────────────

export interface AgentDefinition {
  frontmatter: AgentFrontmatter;
  body: string;
  filePath: string;
}

// ── Agent Reference (lightweight, for config) ────────────────────────

export const AgentRefSchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  color: z.string().default("#438DD5"),
});

export type AgentRef = z.infer<typeof AgentRefSchema>;

// ── Team Config ──────────────────────────────────────────────────────

export const TeamConfigSchema = z.object({
  name: z.string().min(1),
  lead: AgentRefSchema,
  workers: z.array(AgentRefSchema).default([]),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

// ── Model Tier Policy ────────────────────────────────────────────────

export const ModelTierEntrySchema = z.object({
  primary: z.string().min(1),
  fallback: z.string().min(1),
});

export const ModelTierPolicySchema = z.object({
  curator: ModelTierEntrySchema,
  lead: ModelTierEntrySchema,
  worker: ModelTierEntrySchema,
});

export type ModelTierPolicy = z.infer<typeof ModelTierPolicySchema>;

// ── Memory Config ────────────────────────────────────────────────────

export const MemoryConfigSchema = z.object({
  session_retention_days: z.number().int().default(7),
  daily_retention_days: z.number().int().default(30),
  expertise_token_budget: z.number().int().default(3000),
  knowledge_graph_token_budget: z.number().int().default(2000),
  compaction_threshold: z.number().default(0.8),
  compaction_interval_days: z.number().int().default(7),
  low_confidence_threshold: z.number().default(0.3),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ── System Config (multi-team-config.yaml) ───────────────────────────

export const SystemConfigSchema = z.object({
  schema_version: z.number().int().default(SCHEMA_VERSION),
  project_name: z.string().default("agent-maestro"),
  paths: z.object({
    workspace: z.string().default("workspace"),
    agents: z.string().default("agents"),
    skills: z.string().default("skills"),
    memory: z.string().default("memory"),
    logs: z.string().default("logs"),
    shared_context: z.string().default("shared-context"),
  }).default({}),
  maestro: AgentRefSchema,
  teams: z.array(TeamConfigSchema).min(1),
  model_tier_policy: ModelTierPolicySchema,
  memory: MemoryConfigSchema.default({}),
  limits: z.object({
    max_panes: z.number().int().default(10),
    max_delegation_depth: z.number().int().default(5),
    stall_timeout_seconds: z.number().int().default(120),
    task_timeout_seconds: z.number().int().default(600),
    wave_timeout_seconds: z.number().int().default(1800),
    max_reconcile_retries: z.number().int().default(3),
    max_retry_attempts: z.number().int().default(3),
    escalate_after_seconds: z.number().int().default(300),
  }).default({}),
  tmux_session: z.string().default("agent-maestro"),
});

export type SystemConfig = z.infer<typeof SystemConfigSchema>;

// ── Active Worker (runtime tracking) ─────────────────────────────────

export interface ActiveWorker {
  instanceId: string;
  agentName: string;
  runtimeId: string;       // tmux pane ID or container ID
  runtimeType: "tmux" | "container";
  taskId: string;
  role: "maestro" | "lead" | "worker";
  hierarchyLevel: number;
  startedAt: Date;
  lastOutputAt: Date;
  parentTaskId: string | null;
}

// ── Task Types ───────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "plan_ready"
  | "plan_approved"
  | "plan_revision_needed"
  | "complete"
  | "failed";

export type TaskPhase = "phase_1_plan" | "phase_2_execute" | "none";

export interface ParsedTask {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  status: TaskStatus;
  phase: TaskPhase;
  wave: number;
  dependencies: string[];
  parentTask: string | null;
  planFirst: boolean;
  timeBudget: number;       // seconds
  createdAt: string;
  updatedAt: string;
  handoffReport: HandoffReport | null;
  proposedApproach: string | null;
  revisionFeedback: string | null;
}

export interface HandoffReport {
  changesMade: string;
  patternsFollowed: string;
  unresolvedConcerns: string;
  suggestedFollowups: string;
}

// ── File Change Event (file watcher) ─────────────────────────────────

export type FileChangeType =
  | "goal"
  | "plan"
  | "status"
  | "log"
  | "task"
  | "config"
  | "agent"
  | "memory"
  | "skill";

export interface FileChangeEvent {
  path: string;
  type: FileChangeType;
  content: string;
  timestamp: string;
}

// ── Log Entry ────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string;
  agent: string;
  message: string;
}

// ── Session DAG Entry (Level 1 Memory) ───────────────────────────────

export interface SessionDAGEntry {
  id: string;
  parentId: string | null;
  role: "system" | "assistant" | "user" | "tool";
  tool?: string;
  content: string;
  ts: string;
}

// ── Daily Protocol Entry (Level 2 Memory) ────────────────────────────

export interface DailyProtocolEntry {
  time: string;
  agent: string;
  confidence: number;
  content: string;
  sourceTask: string | null;
  category: "finding" | "error_pattern" | "decision";
}

// ── Expertise Entry (Level 3 Memory) ─────────────────────────────────

export interface ExpertiseEntry {
  content: string;
  confidence: number;
  source: string;
  date: string;
}

// ── Knowledge Graph Node (Level 4 Memory) ────────────────────────────

export interface KnowledgeGraphNode {
  id: string;
  domain: string;
  filePath: string;
  linkedNodes: string[];
  curatorAgent: string;
  lastUpdated: string;
}

// ── Session State ────────────────────────────────────────────────────

export interface SessionState {
  sessionId: string;
  tmuxSessionName: string;
  goal: string;
  startedAt: string;
  status: "active" | "paused" | "completed" | "failed";
  currentWave: number;
  activeWorkers: Map<string, ActiveWorker>;
}

// ── Delegation Parameters ────────────────────────────────────────────

export interface DelegationParams {
  agentName: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  wave: number;
  dependencies: string[];
  planFirst: boolean;
  timeBudget: number;
  parentTaskId: string | null;
  delegationDepth: number;
}

// ── Reconciliation Result ────────────────────────────────────────────

export interface ReconcileResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
}

// ── Monitor Result ───────────────────────────────────────────────────

export interface MonitorResult {
  taskId: string;
  agentName: string;
  runtimeAlive: boolean;
  hasNewOutput: boolean;
  taskStatus: TaskStatus | null;
  isStalled: boolean;
  lastOutput: string;
}
