# Agent Maestro - Architecture Documentation (Arc42)

> **Version:** 3.0  
> **Last Updated:** 2026-04-05  
> **Status:** Current architecture + target vision (planned features marked with *[target]*)  
> **Changelog:** v3.0 -- Ground-up redesign. Renamed Orchestrator to **Maestro**; all code references updated (maestro.ts, agents/maestro.md). Level-based hierarchy: L1 Maestro, L2..n-1 Team-Leads, Ln Worker-Agents. **4-level Agent Memory System** fully wired into architecture: Memory Subsystem as first-class container (5.1) and component diagram (5.2.2) with SessionDAGManager, DailyProtocolFlusher, ExpertiseStore, KnowledgeGraphLoader, GitCheckpointEngine, MemoryAccessControl. Knowledge graph branch loading integrated into PromptAssembler (5.2.1, 8.2). Level 3 storage unified to MEMORY.md/EXPERT.md (no more mental-models/*.yaml). Runtime sequences added: Session DAG branching/rewind (6.7), Silent Memory Flush with pre_compaction lifecycle hook (6.8). Lifecycle state machine updated with Flushing and MemoryPromotion states (8.7). **Tiered process isolation**: containers for Workers, tmux for Leads/Maestro (ADR-002 rewritten). **Model tiering policy** in config and agent frontmatter (8.15). Security section rewritten with hierarchy-aligned isolation model (8.5). Git-Memory integration (8.17), Memory Best Practices (8.18), ADR-008. Deployment view updated with container runtime, git engine, memory/ directory structure. Zod schema validation, schema_version in all file formats. Resolved tech debt D1 (python3), F6 (containers), F21 (YAML parsing).  
> v2.0 -- Comprehensive review incorporating production agent orchestration patterns, NotebookLM research (arc42 + agentic AI guides), and gap analysis. Added: agent lifecycle state machine, timeout/deadlock detection, resource management/backpressure, context window management, conflict resolution, domain model, configuration management, logging/audit trail, 3 new ADRs with alternatives considered for all ADRs, structured risk/debt separation, stimulus-response quality scenarios, expanded glossary, future improvements roadmap (Section 13).

---

**Table of Contents**

1. [Introduction and Goals](#1-introduction-and-goals)
2. [Constraints](#2-constraints)
3. [Context and Scope](#3-context-and-scope)
4. [Solution Strategy](#4-solution-strategy)
5. [Building Block View](#5-building-block-view)
6. [Runtime View](#6-runtime-view)
7. [Deployment View](#7-deployment-view)
8. [Cross-cutting Concepts](#8-cross-cutting-concepts)
9. [Architecture Decisions](#9-architecture-decisions)
10. [Quality Requirements](#10-quality-requirements)
11. [Risks and Technical Debt](#11-risks-and-technical-debt)
12. [Glossary](#12-glossary)
13. [Future Improvements and Evolution Roadmap](#13-future-improvements-and-evolution-roadmap)

---

## 1. Introduction and Goals

### 1.1 Business Context

Agent Maestro is a **local-first, hierarchical multi-agent orchestration system** that coordinates specialized AI agents to collaboratively tackle software engineering projects. It runs entirely on the developer's machine -- no cloud deployment, no SaaS dependency.

The system implements an **unlimited-depth, tree-structured agent hierarchy** with a clear level-based role model:
- **Level 1 -- Maestro:** The root agent that holds the strategic overview, decomposes goals, delegates tasks, and manages the central project memory.
- **Level 2 to n-1 -- Team-Leads:** Intermediate agents that create strategies for specific domains (e.g., Backend, DevOps, Validation), manage domain-specific expertise files, and coordinate their sub-agents.
- **Level n -- Worker-Agents:** Leaf agents that execute atomic tasks in isolated sandboxes and deliver structured handoff reports back to their leads.

Any agent with the `delegate` tool can spawn sub-agents, who can in turn spawn their own -- forming a recursive tree with no hard-coded depth limit. Unlike flat agent dispatchers that treat all sessions as peers, this system emphasizes **structured delegation, quality gates, and persistent agent learning** at every level of the tree.

### 1.2 Business Goals

| Priority | Goal | Description |
|----------|------|-------------|
| 1 | **Reliable hierarchical delegation** | Complex software tasks decomposed and delegated through an unlimited-depth agent tree (Maestro -> Team-Leads -> Worker-Agents) with clear accountability at every level |
| 2 | **Persistent agent improvement** | Agents learn from completed tasks through reflection-based training -- append-only mental models with evidence-backed skill progression, not weight fine-tuning |
| 3 | **Extensible plugin architecture** | New agents, skills, runtimes, and integrations addable without core changes -- plugin-slot pattern (Runtime/Workspace/SCM/Tracker/Notifier/Terminal) *[target]* |
| 4 | **Observable, quality-gated execution** | Every delegation, reconciliation, and mental model update traceable end-to-end with evidence-based gamification *[target]* |

### 1.3 Quality Goals

| Priority | Quality Goal | Motivation |
|----------|-------------|------------|
| 1 | **Reliability** | Wave-based delegation must never lose tasks or produce orphaned processes |
| 2 | **Extensibility** | New agents, skills, runtimes addable without modifying core orchestration logic |
| 3 | **Observability** | Full traceability from goal decomposition through task execution to outcome |
| 4 | **Resilience** | Sessions restorable after crashes; workspace state always recoverable |
| 5 | **Security** | Process isolation, input sanitization, secret protection |

### 1.4 Stakeholders

| Stakeholder | Role | Expectations |
|-------------|------|-------------|
| Developer | Primary user | Reliable task execution, transparent progress, quality outcomes |
| Maestro (Level 1) | Top-level coordinator | Clear goal decomposition tools, delegation and monitoring capabilities, central project memory management |
| Team-Leads (Level 2..n-1) | Domain managers at any intermediate tree level | Review tools, sub-agent coordination, quality gate enforcement, domain-specific expertise management |
| Worker-Agents (Level n) | Specialists at leaf level | Clear task descriptions, appropriate skills/tools, structured handoff report format |
| LLM Providers | External services | Stable API access (Google Gemini, Anthropic Claude) |

---

## 2. Constraints

### 2.1 Technical Constraints

| Constraint | Description |
|------------|-------------|
| Local-only execution | No cloud deployment; everything runs on the developer's machine |
| tmux + container runtime | tmux for Maestro/Team-Leads; Docker/Podman for Worker-Agent isolation (Linux/macOS only) |
| LLM provider dependency | Requires API access to Google Gemini or Anthropic Claude via ACP OAuth |
| Node.js 22+ runtime | Web server and TypeScript compilation require modern Node.js |
| Agent framework | Agent runtime uses a coding-agent framework (e.g., Pi) for tool-use, extensions, and session management |
| File-based coordination | Markdown/YAML files in `workspace/` are the canonical state -- no database |
| Git dependency | Memory subsystem requires Git for automated checkpoints, branch-per-worker isolation, and audit trail |

### 2.2 Organizational Constraints

| Constraint | Description |
|------------|-------------|
| Single-developer operation | System designed for one developer orchestrating multiple AI agents |
| No persistent database (yet) | SQLite planned for scores/training history *[target]* |

### 2.3 Convention Constraints

| Constraint | Description |
|------------|-------------|
| Agent format | Markdown files with YAML frontmatter (model, skills, tools, domain permissions). Granting `delegate: true` in tools enables the agent to spawn sub-agents, placing it at any level of the hierarchy tree. |
| Memory system | 4-level memory: session DAG (JSONL), daily protocols (Markdown), long-term expertise (MEMORY.md/EXPERT.md), knowledge graph (Markdown tree) |
| Coordination protocol | All state flows through workspace files (goal.md, plan.md, status.md, log.md, tasks/) |
| Handoff reports | Four mandatory sections: Changes Made / Patterns Followed / Unresolved Concerns / Suggested Follow-ups |

---

## 3. Context and Scope

### 3.1 System Context (C4 Level 1)

The System Context diagram shows Agent Maestro as a black box and its interactions with external actors and systems.

```mermaid
graph TB
    Developer["<b>Developer</b><br/><i>Human User</i><br/>Initiates goals, reviews outcomes,<br/>monitors progress via Web UI"]

    System["<b>Agent Maestro</b><br/><i>Software System</i><br/>Hierarchical multi-agent system that<br/>decomposes goals and delegates work<br/>to specialized AI agents"]

    Gemini["<b>Google Gemini API</b><br/><i>External System</i><br/>LLM provider for agent reasoning"]
    Claude["<b>Anthropic Claude ACP</b><br/><i>External System</i><br/>LLM provider via OAuth"]
    NotebookLM["<b>Google NotebookLM</b><br/><i>External System</i><br/>Source-grounded research from<br/>uploaded documents"]
    FileSystem["<b>Local File System</b><br/><i>Infrastructure</i><br/>Workspace artifacts, agent definitions,<br/>mental models, skills"]
    Tmux["<b>tmux</b><br/><i>Infrastructure</i><br/>Terminal multiplexer for<br/>process isolation"]
    Git["<b>Git / GitHub</b><br/><i>External System [target]</i><br/>Version control, PRs, CI"]
    Tracker["<b>Linear / Jira</b><br/><i>External System [target]</i><br/>Issue tracking"]

    Developer -- "Manages tasks, reviews code via<br/>Web UI (HTTP/WS) and CLI (run.sh)" --> System
    System -- "Requests completions<br/>and reasoning (HTTPS)" --> Gemini
    System -- "Requests completions<br/>via OAuth (HTTPS)" --> Claude
    System -- "Queries research documents<br/>via browser automation (Playwright)" --> NotebookLM
    System -- "Reads/writes workspace artifacts,<br/>agent prompts, mental models" --> FileSystem
    System -- "Spawns isolated agent processes<br/>in panes (shell exec)" --> Tmux
    System -. "Creates branches, PRs,<br/>reads CI status [target]" .-> Git
    System -. "Creates/updates issues,<br/>links tasks [target]" .-> Tracker

    style System fill:#438DD5,color:#fff
    style Developer fill:#08427B,color:#fff
    style Gemini fill:#999,color:#fff
    style Claude fill:#999,color:#fff
    style NotebookLM fill:#999,color:#fff
    style FileSystem fill:#999,color:#fff
    style Tmux fill:#999,color:#fff
    style Git fill:#666,color:#fff,stroke-dasharray: 5 5
    style Tracker fill:#666,color:#fff,stroke-dasharray: 5 5
```

### 3.2 Business Context

| Communication Partner | Input | Output | Protocol |
|----------------------|-------|--------|----------|
| Developer | Goals, plan approvals, config changes | Task outcomes, progress updates, handoff reports | HTTP REST, WebSocket, CLI |
| Google Gemini API | Prompts with system context | LLM completions, tool calls | HTTPS (API key) |
| Anthropic Claude ACP | Prompts with system context | LLM completions, tool calls | HTTPS (OAuth token) |
| Google NotebookLM | Research questions | Source-grounded answers from uploaded docs | Browser automation (Playwright) |
| Local File System | File reads | Workspace artifacts, config, agent definitions | Node.js fs / shell |
| tmux | Session/pane commands | Process isolation, output capture | Shell exec |

---

## 4. Solution Strategy

The following fundamental decisions shape the architecture:

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Unlimited-depth hierarchical delegation** | Recursive tree structure: any agent with the `delegate` tool can spawn sub-agents to any depth. Level 1 is always the Maestro, levels 2..n-1 are Team-Leads, and level n agents are Worker-Agents. Teams and sub-teams can be added without architectural changes. |
| 2 | **File-based coordination** | Markdown/YAML files in `workspace/` as canonical state. Human-readable, git-trackable, crash-recoverable. No database needed for core orchestration. |
| 3 | **Coding-agent framework as runtime** | Each agent runs as an isolated process with its own system prompt, 4-level memory context, and skill injection. Leverages a tool-use and extension framework. |
| 4 | **Tiered process isolation** | Maestro and Team-Leads run in tmux panes (debuggable via `attach`). Worker-Agents run in containers with cgroup resource limits. Dev-mode fallback: all agents in tmux. |
| 5 | **Wave-based scheduling** | Tasks sorted into dependency waves. All tasks in wave N must complete before wave N+1 starts. Prevents race conditions on shared artifacts. |
| 6 | **Quality gates as protocol** | Plan-approval gate (plan_ready -> plan_approved), reconciliation loop (validation command -> fix-task on failure), structured handoff reports. |
| 7 | **4-level memory system** | Agent memory organized in 4 levels: L1 Session DAG (ephemeral JSONL), L2 Daily Protocols (episodic Markdown), L3 Expertise (MEMORY.md/EXPERT.md, domain-locked), L4 Knowledge Graph (Maestro-curated Markdown tree). Hierarchy-governed write permissions. Git-integrated audit trail. |
| 8 | **Plugin-slot architecture** *[target]* | Runtime/Workspace/SCM/Tracker/Notifier/Terminal as swappable interfaces. Decouples core from integrations. |
| 9 | **Reflection-based training** *[target]* | Reflexion-style improvement through evidence-backed learnings. Training pipeline: Outcome Evidence -> Reflection Summary -> Skill Update. No weight fine-tuning. |
| 10 | **Evidence-gated gamification** *[target]* | XP = Base x Quality x Difficulty x Novelty x Integrity. XP tied to hard signals (CI pass, review approval, reconcile pass). Anti-gaming mechanisms built in. |
| 11 | **Layered fault tolerance** | Defense-in-depth: tmux crash resilience, session resume, LLM failover chains, stall detection with escalation ladder, reconciliation retry loops. No single failure should lose completed work. |
| 12 | **Resource-aware backpressure** | Spawn budget (max panes), wave-based scheduling, and delegation depth guards prevent resource exhaustion. New delegations queue when at capacity. |
| 13 | **Context window budgeting** | Token budget allocation per prompt component. Mental model pruning, skill progressive disclosure, and sub-agent context isolation prevent context rot in deep hierarchies. |

---

## 5. Building Block View

The Building Block View uses the C4 model's hierarchical decomposition: Container (Level 2) -> Component (Level 3) -> Code (Level 4).

### 5.1 Level 1 -- Container Diagram (C4 Level 2)

Shows the high-level technical building blocks within the system boundary.

```mermaid
graph TB
    subgraph boundary ["Agent Maestro System"]
        direction TB

        MaestroRT["<b>Maestro Runtime</b><br/><i>TypeScript (maestro.ts)</i><br/>Core orchestration engine with tools:<br/>delegate, monitor, reconcile,<br/>write_task, update_memory"]

        MemorySubsystem["<b>Memory Subsystem</b><br/><i>TypeScript</i><br/>4-level memory management:<br/>SessionDAG, DailyProtocol,<br/>ExpertiseStore, KnowledgeGraph,<br/>GitCheckpoint"]

        WebServer["<b>Web Server</b><br/><i>Express.js, Port 3000</i><br/>REST API for workspace, tasks,<br/>agents, config, session, skills,<br/>memory"]

        WSServer["<b>WebSocket Server</b><br/><i>ws library</i><br/>Real-time file change events,<br/>pane output streaming"]

        FileWatcher["<b>File Watcher</b><br/><i>Chokidar</i><br/>Monitors workspace/, agents/,<br/>memory/, skills/, config"]

        WebClient["<b>Web Client</b><br/><i>Vanilla JS SPA</i><br/>Chat-like delegation view,<br/>Dashboard, Tasks, Agents,<br/>Memory Explorer, Config"]

        RuntimeMgr["<b>Runtime Manager</b><br/><i>tmux / Container</i><br/>Agent process isolation:<br/>tmux panes (dev mode),<br/>containers (production mode)"]

        Workspace["<b>Workspace</b><br/><i>File System</i><br/>goal.md, plan.md, status.md,<br/>log.md, tasks/"]

        AgentReg["<b>Agent Registry</b><br/><i>File System</i><br/>agents/maestro.md,<br/>agents/leads/*.md,<br/>agents/workers/*.md"]

        MemoryStore["<b>Memory Store</b><br/><i>File System</i><br/>memory/sessions/ (JSONL DAGs)<br/>memory/daily/ (protocols)<br/>memory/agents/ (MEMORY.md, EXPERT.md)<br/>memory/knowledge-graph/ (Markdown tree)"]

        SkillLib["<b>Skill Library</b><br/><i>File System</i><br/>skills/*.md<br/>Reusable capability documents"]

        GitEngine["<b>Git Engine</b><br/><i>Git CLI</i><br/>Automated checkpoints,<br/>branch-per-worker isolation,<br/>memory commit conventions"]

        TrainingPipeline["<b>Training Pipeline</b><br/><i>[target]</i><br/>Reflection summaries,<br/>outcome evidence, skill updates"]

        ScoreService["<b>Score / XP Service</b><br/><i>SQLite [target]</i><br/>XP ledger, skill progress,<br/>anti-gaming enforcement"]

        MetaAgent["<b>Meta-Agent Service</b><br/><i>[target]</i><br/>Team composition optimization<br/>from historical mission data"]

        PluginRegistry["<b>Plugin Registry</b><br/><i>[target]</i><br/>Runtime/Workspace/SCM/<br/>Tracker/Notifier/Terminal slots"]
    end

    Developer["<b>Developer</b>"]
    LLM["<b>LLM Providers</b><br/><i>Gemini / Claude</i>"]
    NLM["<b>NotebookLM</b>"]

    Developer -- "HTTP / WS" --> WebClient
    Developer -- "CLI (run.sh)" --> MaestroRT
    WebClient -- "REST API" --> WebServer
    WebClient -- "WS" --> WSServer
    WebServer -- "file I/O" --> Workspace
    WebServer -- "file I/O" --> AgentReg
    WebServer -- "file I/O" --> MemoryStore
    WebServer -- "file I/O" --> SkillLib
    WebServer -- "exec" --> RuntimeMgr
    FileWatcher -- "events:<br/>file:changed,<br/>log:entry" --> WSServer
    FileWatcher -- "watches" --> Workspace
    FileWatcher -- "watches" --> AgentReg
    FileWatcher -- "watches" --> MemoryStore
    MaestroRT -- "spawn agents" --> RuntimeMgr
    MaestroRT -- "read/write" --> Workspace
    MaestroRT -- "read" --> AgentReg
    MaestroRT -- "read/write<br/>(all 4 levels)" --> MemorySubsystem
    MaestroRT -- "read" --> SkillLib
    MaestroRT -- "API calls" --> LLM
    MaestroRT -- "queries" --> NLM
    MemorySubsystem -- "read/write" --> MemoryStore
    MemorySubsystem -- "commits/branches" --> GitEngine
    TrainingPipeline -. "reads outcomes" .-> Workspace
    TrainingPipeline -. "updates via" .-> MemorySubsystem
    TrainingPipeline -. "writes" .-> ScoreService
    MetaAgent -. "reads scores" .-> ScoreService
    MetaAgent -. "reads" .-> AgentReg

    style boundary fill:none,stroke:#438DD5,stroke-width:2px
    style MaestroRT fill:#438DD5,color:#fff
    style MemorySubsystem fill:#438DD5,color:#fff
    style WebServer fill:#438DD5,color:#fff
    style WSServer fill:#438DD5,color:#fff
    style FileWatcher fill:#438DD5,color:#fff
    style WebClient fill:#438DD5,color:#fff
    style RuntimeMgr fill:#438DD5,color:#fff
    style Workspace fill:#438DD5,color:#fff
    style AgentReg fill:#438DD5,color:#fff
    style MemoryStore fill:#438DD5,color:#fff
    style SkillLib fill:#438DD5,color:#fff
    style GitEngine fill:#438DD5,color:#fff
    style TrainingPipeline fill:#666,color:#fff,stroke-dasharray: 5 5
    style ScoreService fill:#666,color:#fff,stroke-dasharray: 5 5
    style MetaAgent fill:#666,color:#fff,stroke-dasharray: 5 5
    style PluginRegistry fill:#666,color:#fff,stroke-dasharray: 5 5
    style Developer fill:#08427B,color:#fff
    style LLM fill:#999,color:#fff
    style NLM fill:#999,color:#fff
```

### 5.2 Level 2 -- Component Diagrams (C4 Level 3)

#### 5.2.1 Maestro Runtime Components

Source: `src/maestro.ts`

```mermaid
graph TB
    subgraph MaestroRuntime ["Maestro Runtime (src/maestro.ts)"]
        ConfigLoader["<b>Config Loader</b><br/>loadConfig()<br/>parseFrontmatter()<br/>Zod schema validation"]

        AgentResolver["<b>Agent Resolver</b><br/>findAgentByName()<br/>getAllAgents()<br/>readAgent()"]

        PromptAssembler["<b>Prompt Assembler</b><br/>Assembles: agent body +<br/>expertise (MEMORY.md/EXPERT.md) +<br/>knowledge graph branches +<br/>skills + shared context +<br/>task + plan-gate instructions"]

        DelegationEngine["<b>Delegation Engine</b><br/><i>delegate tool</i><br/>Creates task file, spawns agent<br/>in runtime (tmux/container),<br/>tracks workers"]

        MonitorEngine["<b>Monitoring Engine</b><br/><i>monitor tool</i><br/>Captures output, reads status,<br/>detects completion/stalls"]

        ReconcileEngine["<b>Reconciliation Engine</b><br/><i>reconcile tool</i><br/>Runs validation commands,<br/>auto-creates fix-tasks on failure"]

        TaskManager["<b>Task Manager</b><br/><i>write_task, read_task,<br/>update_status tools</i><br/>CRUD on workspace/tasks/"]

        NotebookLMClient["<b>NotebookLM Client</b><br/><i>query_notebooklm,<br/>list_notebooks tools</i><br/>Browser automation queries"]

        ContextInjector["<b>Shared Context Injector</b><br/><i>before_agent_start hook</i><br/>Injects team structure +<br/>shared context into prompts"]

        Logger["<b>Logger</b><br/>logEntry()<br/>Appends to workspace/log.md"]

        ActiveWorkers["<b>Active Workers Map</b><br/>Map&lt;taskId, ActiveWorker&gt;<br/>In-memory tracking of<br/>spawned agent processes"]
    end

    ConfigLoader --> AgentResolver
    AgentResolver --> PromptAssembler
    PromptAssembler --> DelegationEngine
    DelegationEngine --> ActiveWorkers
    DelegationEngine --> TaskManager
    DelegationEngine --> Logger
    MonitorEngine --> ActiveWorkers
    ReconcileEngine --> TaskManager
    ContextInjector --> ConfigLoader

    style MaestroRuntime fill:none,stroke:#438DD5,stroke-width:2px
    style ConfigLoader fill:#85BBF0,color:#000
    style AgentResolver fill:#85BBF0,color:#000
    style PromptAssembler fill:#85BBF0,color:#000
    style DelegationEngine fill:#85BBF0,color:#000
    style MonitorEngine fill:#85BBF0,color:#000
    style ReconcileEngine fill:#85BBF0,color:#000
    style TaskManager fill:#85BBF0,color:#000
    style NotebookLMClient fill:#85BBF0,color:#000
    style ContextInjector fill:#85BBF0,color:#000
    style Logger fill:#85BBF0,color:#000
    style ActiveWorkers fill:#85BBF0,color:#000
```

#### 5.2.2 Memory Subsystem Components

Source: `src/memory/`

The Memory Subsystem is a **first-class container** responsible for operating all four memory levels. Each level is managed by a dedicated component with clear interfaces. The subsystem is accessed by the Maestro Runtime at delegation time (prompt assembly), during agent execution (session writes, flush triggers), and at completion (learning promotion, git checkpoints).

```mermaid
graph TB
    subgraph MemSubsystem ["Memory Subsystem (src/memory/)"]
        SessionDAGMgr["<b>Session DAG Manager</b><br/><i>Level 1</i><br/>JSONL append, branch/rewind,<br/>leaf pointer tracking,<br/>garbage collection"]

        DailyProtocolFlusher["<b>Daily Protocol Flusher</b><br/><i>Level 2</i><br/>Silent Memory Flush hook,<br/>delta-append to YYYY-MM-DD.md,<br/>retention policy (30 days)"]

        ExpertiseStore["<b>Expertise Store</b><br/><i>Level 3</i><br/>MEMORY.md / EXPERT.md per agent,<br/>domain-locked writes,<br/>append-only with confidence,<br/>compaction/archival"]

        KnowledgeGraphLoader["<b>Knowledge Graph Loader</b><br/><i>Level 4</i><br/>Reads memory/knowledge-graph/index.md,<br/>selects relevant branches by task domain,<br/>returns token-budgeted context slice"]

        GitCheckpointEngine["<b>Git Checkpoint Engine</b><br/>Automated commits (mem: prefix),<br/>branch-per-worker isolation,<br/>merge-on-completion,<br/>post-turn / post-wave hooks"]

        MemoryAccessControl["<b>Memory Access Control</b><br/>Enforces write permissions<br/>by hierarchy level:<br/>Maestro: all levels<br/>Team-Leads: L1-L3 (own domain)<br/>Workers: L1-L2 only"]
    end

    MRT["Maestro Runtime"]
    FS["Memory Store<br/>(File System)"]
    Git["Git Repository"]

    MRT -- "prompt assembly:<br/>load L3 expertise +<br/>L4 graph branches" --> KnowledgeGraphLoader
    MRT -- "prompt assembly:<br/>load L3 expertise" --> ExpertiseStore
    MRT -- "delegation:<br/>create session DAG" --> SessionDAGMgr
    MRT -- "completion:<br/>trigger flush + checkpoint" --> DailyProtocolFlusher
    MRT -- "completion:<br/>trigger checkpoint" --> GitCheckpointEngine

    SessionDAGMgr -- "read/write<br/>memory/sessions/*.jsonl" --> FS
    DailyProtocolFlusher -- "append<br/>memory/daily/*.md" --> FS
    ExpertiseStore -- "read/write<br/>memory/agents/*/MEMORY.md<br/>memory/agents/*/EXPERT.md" --> FS
    KnowledgeGraphLoader -- "read<br/>memory/knowledge-graph/**/*.md" --> FS
    GitCheckpointEngine -- "commit/branch/merge" --> Git

    MemoryAccessControl -- "enforces" --> SessionDAGMgr
    MemoryAccessControl -- "enforces" --> DailyProtocolFlusher
    MemoryAccessControl -- "enforces" --> ExpertiseStore

    style MemSubsystem fill:none,stroke:#438DD5,stroke-width:2px
    style SessionDAGMgr fill:#FFCCBC,color:#000
    style DailyProtocolFlusher fill:#FFE0B2,color:#000
    style ExpertiseStore fill:#C8E6C9,color:#000
    style KnowledgeGraphLoader fill:#BBDEFB,color:#000
    style GitCheckpointEngine fill:#D1C4E9,color:#000
    style MemoryAccessControl fill:#F5F5F5,color:#000
```

**Component responsibilities:**

| Component | Memory Level | Trigger | Input | Output |
|-----------|-------------|---------|-------|--------|
| **SessionDAGManager** | L1 (Ephemeral) | Agent spawn / every tool call | Message with `id` + `parentId` | Appended JSONL entry; branch pointer updates |
| **DailyProtocolFlusher** | L2 (Episodic) | `pre_compaction` lifecycle hook; `post_turn` hook | Agent's current session findings | Delta-appended bullets in `YYYY-MM-DD.md` with metadata |
| **ExpertiseStore** | L3 (Semantic) | Team-Lead promotes learning from L2; `update_memory` tool | Curated pattern with confidence score | Appended entry in agent's `MEMORY.md` or `EXPERT.md` |
| **KnowledgeGraphLoader** | L4 (Persistent) | Prompt assembly (delegation time) | Task domain tags + token budget | Token-budgeted Markdown slice from relevant graph branches |
| **GitCheckpointEngine** | Cross-level | `post_turn`, `post_wave`, agent completion | Memory file changes | Git commit with `mem:` prefix; branch management |
| **MemoryAccessControl** | Cross-level | Every memory write operation | Agent hierarchy level + target memory level | Allow / deny decision |

#### 5.2.3 Web Server Components

Source: `web/server/`

```mermaid
graph TB
    subgraph WebServerBoundary ["Web Server (web/server/)"]
        ExpressApp["<b>Express App</b><br/>index.ts<br/>Middleware, static serving,<br/>route registration"]

        subgraph Routes ["API Routes (web/server/routes/)"]
            WorkspaceR["workspace.ts<br/>GET /api/workspace/{goal,plan,status,log}"]
            TaskR["tasks.ts<br/>GET/PUT /api/tasks, /api/tasks/:id"]
            AgentR["agents.ts<br/>GET /api/agents, /api/agents/:slug"]
            ConfigR["config.ts<br/>GET /api/config"]
            SessionR["session.ts<br/>GET /api/session/active<br/>POST /api/session/{start,stop}"]
            SkillR["skills.ts<br/>GET /api/skills"]
            ActionR["actions.ts<br/>POST /api/actions/{approve-plan,<br/>delegate,reconcile}"]
            TmuxR["tmux.ts<br/>tmux pane operations"]
            NLMR["notebooklm.ts<br/>NotebookLM queries"]
        end

        subgraph Services ["Services (web/server/services/)"]
            FWS["<b>FileWatcherService</b><br/>file-watcher.ts<br/>Chokidar, classifyFile(),<br/>emits file:changed + log:entry"]
            TPS["<b>TaskParser</b><br/>task-parser.ts<br/>parseTaskFile(), loadAllTasks()"]
            CPS["<b>ConfigParser</b><br/>config-parser.ts<br/>loadConfig(), getAllAgents()"]
            MTP["<b>MarkdownTableParser</b><br/>markdown-table.ts<br/>parseMarkdownTable(),<br/>parseLogEntries()"]
            TMS["<b>TmuxService</b><br/>tmux.ts<br/>sessionExists(), listPanes(),<br/>capturePane(), sendKeys()"]
        end

        WSHandler["<b>WebSocket Handler</b><br/>ws/handler.ts<br/>broadcast(), pane subscriptions<br/>with 2.5s polling interval"]
    end

    ExpressApp --> Routes
    Routes --> Services
    FWS --> WSHandler
    TmuxR --> TMS

    style WebServerBoundary fill:none,stroke:#438DD5,stroke-width:2px
    style ExpressApp fill:#85BBF0,color:#000
    style WSHandler fill:#85BBF0,color:#000
    style FWS fill:#85BBF0,color:#000
    style TPS fill:#85BBF0,color:#000
    style CPS fill:#85BBF0,color:#000
    style MTP fill:#85BBF0,color:#000
    style TMS fill:#85BBF0,color:#000
```

#### 5.2.4 Agent Hierarchy (Domain Building Blocks)

The agent hierarchy is an **unlimited-depth, extensible tree structure** with a clear level-based role model:
- **Level 1 -- Maestro:** The singular root agent. Holds the strategic overview, decomposes goals, delegates to Team-Leads, monitors progress, runs reconciliation, and manages the central project memory (knowledge graph).
- **Level 2 to n-1 -- Team-Leads:** Intermediate agents that create strategies for specific domains, manage domain-specific expertise files (EXPERT.md), coordinate their sub-agents, and enforce quality gates. A Team-Lead can delegate to further Team-Leads (deeper levels) or to Worker-Agents.
- **Level n -- Worker-Agents:** Leaf agents that execute atomic tasks in isolated sandboxes. They deliver structured handoff reports back to their leads but do not spawn sub-agents.

Any agent that has the `delegate` tool can spawn sub-agents, who can in turn spawn their own -- forming a recursive tree with no hard-coded depth or team-size limit. The tree shape is purely a configuration concern: add agent `.md` files and reference them in `multi-team-config.yaml` to grow the tree in any direction.

The diagram below shows the **default configuration** (3 levels, 3 teams) as an example. The dashed sub-tree illustrates how any Team-Lead can be extended with further sub-agents to arbitrary depth.

```mermaid
graph TB
    subgraph Hierarchy ["Agent Hierarchy (unlimited depth: Maestro → Team-Leads → Worker-Agents)"]
        Orch["<b>Maestro</b> (Level 1)<br/>agents/maestro.md<br/><i>Model: gemini-2.5-pro</i><br/>Tools: delegate, monitor,<br/>reconcile, write_task,<br/>update_memory,<br/>query_notebooklm"]

        subgraph PlanningTeam ["Planning Team"]
            PL["<b>Planning Lead</b> (Level 2)<br/>agents/leads/planning-lead.md<br/>Tools: delegate, read, write,<br/>bash, edit, query_notebooklm"]
            PM["<b>Product Manager</b> (Level 3 / Worker)<br/>agents/workers/product-manager.md<br/>Tools: read, write, bash, edit"]
            UX["<b>UX Researcher</b> (Level 3 / Worker)<br/>agents/workers/ux-researcher.md<br/>Tools: read, write, bash, edit"]
        end

        subgraph EngineeringTeam ["Engineering Team"]
            EL["<b>Engineering Lead</b> (Level 2)<br/>agents/leads/engineering-lead.md<br/>Tools: delegate, read, write,<br/>bash, edit, query_notebooklm"]
            FE["<b>Frontend Dev</b> (Level 3 / Worker)<br/>agents/workers/frontend-dev.md<br/>Tools: read, write, bash, edit"]
            BE["<b>Backend Dev</b> (Level 3 / Team-Lead)<br/>agents/workers/backend-dev.md<br/>Tools: read, write, bash, edit,<br/><b>delegate</b>"]
        end

        subgraph ValidationTeam ["Validation Team"]
            VL["<b>Validation Lead</b> (Level 2)<br/>agents/leads/validation-lead.md<br/>Tools: delegate, read, write,<br/>bash, edit, query_notebooklm"]
            QA["<b>QA Engineer</b> (Level 3 / Worker)<br/>agents/workers/qa-engineer.md<br/>Tools: read, write, bash, edit"]
            SR["<b>Security Reviewer</b> (Level 3 / Worker)<br/>agents/workers/security-reviewer.md<br/>Tools: read, write, bash, edit"]
        end

        subgraph SubTeam ["Sub-Team (Level 4+: Backend Dev as Team-Lead)"]
            DBSpec["<b>DB Specialist</b> (Level 4 / Worker)<br/>agents/workers/db-specialist.md"]
            APISpec["<b>API Specialist</b> (Level 4 / Worker)<br/>agents/workers/api-specialist.md"]
        end

        MoreAgents["<b>...</b><br/><i>any depth,<br/>any team size</i>"]
    end

    Orch --> PL
    Orch --> EL
    Orch --> VL
    PL --> PM
    PL --> UX
    EL --> FE
    EL --> BE
    VL --> QA
    VL --> SR
    BE -.-> DBSpec
    BE -.-> APISpec
    DBSpec -.-> MoreAgents

    style Hierarchy fill:none,stroke:#438DD5,stroke-width:2px
    style Orch fill:#FF6B6B,color:#fff
    style PlanningTeam fill:none,stroke:#4ECDC4,stroke-width:1px
    style EngineeringTeam fill:none,stroke:#FFEAA7,stroke-width:1px
    style ValidationTeam fill:none,stroke:#F7DC6F,stroke-width:1px
    style SubTeam fill:none,stroke:#999,stroke-width:1px,stroke-dasharray: 5 5
    style PL fill:#4ECDC4,color:#000
    style PM fill:#45B7D1,color:#fff
    style UX fill:#96CEB4,color:#000
    style EL fill:#FFEAA7,color:#000
    style FE fill:#DDA0DD,color:#000
    style BE fill:#98D8C8,color:#000
    style VL fill:#F7DC6F,color:#000
    style QA fill:#BB8FCE,color:#fff
    style SR fill:#F1948A,color:#000
    style DBSpec fill:#ccc,color:#000,stroke-dasharray: 5 5
    style APISpec fill:#ccc,color:#000,stroke-dasharray: 5 5
    style MoreAgents fill:none,stroke:#999,stroke-dasharray: 5 5
```

**How to extend the tree:**

| Action | How |
|--------|-----|
| Add a new Worker-Agent (level n) | Create an agent `.md` file with YAML frontmatter. No `delegate` tool needed. |
| Add a new Team-Lead (level 2..n-1) | Create an agent `.md` file with `delegate: true` in `tools`. The agent becomes an intermediate node managing its own sub-agents. |
| Add a new team | Add a team entry in `multi-team-config.yaml` with a lead and workers. |
| Deepen the hierarchy | Grant the `delegate` tool to any existing Worker-Agent, promoting it to Team-Lead. Provide sub-agent definitions for it to delegate to. |
| Grow a team | Add more worker entries under any team in the config YAML. No code changes needed. |

#### 5.2.5 Target Plugin Architecture *[target]*

Each plugin slot defines a stable interface with swappable implementations.

```mermaid
graph TB
    subgraph PluginArch ["Plugin Architecture [target]"]
        subgraph RuntimeSlot ["RuntimePlugin"]
            RTI["<b>Interface</b><br/>create(), send(), getOutput(),<br/>isAlive(), destroy()"]
            RT1["tmux<br/><i>current</i>"]
            RT2["process<br/><i>fallback</i>"]
            RT3["container<br/><i>target</i>"]
        end

        subgraph WorkspaceSlot ["WorkspacePlugin"]
            WSI["<b>Interface</b><br/>create(), clone(),<br/>isolate(), merge()"]
            WS1["local-fs<br/><i>current</i>"]
            WS2["git-worktree<br/><i>target</i>"]
        end

        subgraph SCMSlot ["SCMPlugin"]
            SCMI["<b>Interface</b><br/>createBranch(), commit(),<br/>createPR(), getCIStatus()"]
            SCM1["github<br/><i>target</i>"]
        end

        subgraph TrackerSlot ["TrackerPlugin"]
            TRI["<b>Interface</b><br/>createIssue(), updateIssue(),<br/>linkPR()"]
            TR1["linear<br/><i>target</i>"]
            TR2["jira<br/><i>target</i>"]
        end

        subgraph NotifierSlot ["NotifierPlugin"]
            NI["<b>Interface</b><br/>send(), subscribe()"]
            N1["console<br/><i>current</i>"]
            N2["slack<br/><i>target</i>"]
        end

        subgraph TerminalSlot ["TerminalPlugin"]
            TEI["<b>Interface</b><br/>spawn(), attach(),<br/>capture(), resize()"]
            TE1["tmux-pane<br/><i>current</i>"]
            TE2["ttyd<br/><i>target</i>"]
            TE3["node-pty<br/><i>target</i>"]
        end
    end

    RTI --> RT1
    RTI --> RT2
    RTI --> RT3
    WSI --> WS1
    WSI --> WS2
    SCMI --> SCM1
    TRI --> TR1
    TRI --> TR2
    NI --> N1
    NI --> N2
    TEI --> TE1
    TEI --> TE2
    TEI --> TE3

    style PluginArch fill:none,stroke:#666,stroke-width:2px,stroke-dasharray: 5 5
```

### 5.3 Level 3 -- Code Level (C4 Level 4)

Key types and interfaces with their source locations.

#### Core Types (`src/maestro.ts`)

| Type | Location | Purpose |
|------|----------|---------|
| `SystemConfig` | `maestro.ts` | Team structure, paths, model tier policy, memory config -- parsed from `multi-team-config.yaml` via Zod |
| `AgentFrontmatter` | `maestro.ts` | Per-agent: name, model, model_tier, expertise path, skills, tool permissions, memory permissions, domain restrictions |
| `ActiveWorker` | `maestro.ts` | Runtime tracking: agent name, runtime ID (pane/container), task ID, role, hierarchy level, start timestamp |
| `AgentRef` | `maestro.ts` | Lightweight agent reference: name, file path, UI color, hierarchy level |
| `TeamConfig` | `maestro.ts` | Team definition: name, lead AgentRef, workers AgentRef[] |
| `MemoryConfig` | `memory/` | Per-level configuration: retention policies, token budgets, compaction schedule |

#### Web Server Types (`web/server/`)

| Type | Location | Purpose |
|------|----------|---------|
| `FileChangeEvent` | `services/file-watcher.ts` | Typed file change: path, type (goal/plan/status/log/task/config/agent/mental-model/skill), content |
| `ParsedTask` | `services/task-parser.ts` | Structured task: id, title, description, assignedTo, status, phase, output sections |
| `LogEntry` | `services/markdown-table.ts` | Parsed log row: timestamp, agent, message |

#### Agent Prompt Structure

Each agent `.md` file follows this frontmatter schema:

```yaml
---
schema_version: 1
name: string            # Display name (e.g., "Backend Dev")
model: string           # LLM model ID (e.g., "google/gemini-2.5-pro")
model_tier: string      # One of: curator | lead | worker (see Section 8.15)
expertise: string       # Path to memory directory (memory/agents/{name}/)
skills:                 # List of skill document paths
  - skills/api-design.md
  - skills/code-review.md
tools:                  # Tool permissions (map, not list)
  read: true
  write: true
  bash: true
  edit: true
  delegate: false       # Only Maestro and Team-Leads get delegate
  update_memory: false  # Memory write access (L3); see MemoryAccessControl
memory:                 # Memory access permissions
  write_levels: [1, 2]  # Which memory levels this agent can write to
  domain_lock: null     # Domain for EXPERT.md write access (null = no domain lock)
domain:                 # File access restrictions
  read: ["**/*"]
  upsert: ["workspace/**", "src/**"]
  delete: []
---
[System prompt body in Markdown]
```

#### Memory Level 3 Structure (`memory/agents/{name}/`)

Each agent has two Level 3 files managed by the **ExpertiseStore** component (Section 5.2.2):

**`MEMORY.md`** — Per-agent learnings (append-only, confidence-scored):

```markdown
---
agent: backend-dev
updated: 2026-04-05
schema_version: 1
---

## Preferences
- Prefers explicit error handling over catch-all

## Patterns Learned
- **API design for auth endpoints** (confidence: 0.85)
  Always validate token expiry before processing.
  _Source: task-003, 2026-04-04_

## Strengths
- RESTful API design
- Database schema optimization

## Mistakes to Avoid
- Do not modify shared config files without checking status.md first

## Collaborations
- **Frontend Dev**: Coordinate on API contract changes via plan.md
```

**`EXPERT.md`** — Domain expertise (domain-locked, only the designated Team-Lead writes):

```markdown
---
domain: backend
owner: engineering-lead
updated: 2026-04-05
schema_version: 1
---

## Coding Standards
- All API endpoints must return structured error objects (code, message, details)
- Database migrations use sequential numbered files in `migrations/`

## Architecture Patterns
- Repository pattern for all data access
- Event-driven communication between bounded contexts

## Proven Heuristics
- **Auth token flow** (confidence: 0.95): validate exp → check revocation list → extract claims
  _Source: task-003 reconciliation pass, 2026-04-04_
```

---

## 6. Runtime View

### 6.1 Full Delegation Flow

The core workflow: from goal to task completion through the agent hierarchy (shown here with a 3-level configuration: Maestro -> Team-Lead -> Worker-Agent, but the delegation mechanism is recursive -- any agent with the `delegate` tool can spawn further sub-agents to arbitrary depth).

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant RS as run.sh
    participant Tmux as tmux
    participant Maestro as Maestro [Level 1]
    participant WS as Workspace Files
    participant Lead as Team-Lead [Level 2]
    participant Worker as Worker-Agent [Level 3]
    participant LLM as LLM Provider

    Dev->>RS: ./run.sh "Build auth module"
    RS->>WS: Write goal.md
    RS->>Tmux: Create session "agent-orchestrator"
    RS->>Tmux: Launch agent runtime (maestro.ts)

    activate Maestro
    Maestro->>WS: Read goal.md
    Maestro->>LLM: Reason about decomposition
    LLM-->>Maestro: Task breakdown

    Note over Maestro,WS: Wave 1: Planning
    Maestro->>WS: write_task (task-001, task-002)
    Maestro->>Tmux: delegate("Planning Lead", task-001)
    Tmux->>Lead: Spawn agent in runtime
    activate Lead
    Lead->>WS: Read task file
    Lead->>LLM: Plan approach
    Lead->>WS: Write plan.md
    Lead->>WS: Update task status: complete
    deactivate Lead

    Maestro->>WS: monitor(task-001) -- polls status

    Note over Maestro,WS: Wave 2: Engineering
    Maestro->>Tmux: delegate("Engineering Lead", task-003)
    Tmux->>Lead: Spawn agent in runtime
    activate Lead
    Lead->>Tmux: delegate("Backend Dev", subtask)
    Tmux->>Worker: Spawn agent in runtime
    activate Worker
    Worker->>WS: Read task, implement
    Worker->>LLM: Code generation
    Worker->>WS: Write handoff report
    Worker->>WS: Status: complete
    deactivate Worker
    Lead->>WS: Review, status: complete
    deactivate Lead

    Note over Maestro,WS: Reconciliation
    Maestro->>Maestro: reconcile("tsc --noEmit")
    alt PASS
        Maestro->>WS: Log: reconcile passed
    else FAIL
        Maestro->>WS: Auto-create fix-task
        Maestro->>Tmux: delegate fix-task
    end
    deactivate Maestro
```

### 6.2 Plan-Approval Gate (Two-Phase Protocol)

Quality gate ensuring workers plan before implementing.

```mermaid
sequenceDiagram
    participant Lead as Lead Agent
    participant WS as Workspace
    participant Worker as Worker Agent
    participant FW as File Watcher
    participant UI as Web UI

    Lead->>WS: delegate(worker, task, plan_first: true)
    Note over WS: Task created with<br/>Phase: phase_1_plan<br/>Status: pending

    activate Worker
    Worker->>WS: Read task description

    Note over Worker: Phase 1: Plan Only
    Worker->>WS: Write "Proposed Approach" section
    Worker->>WS: Set Status: "plan_ready"
    Worker->>Worker: STOP -- do not implement

    FW->>UI: file:changed (task file)
    UI->>UI: Show plan for review

    Note over Lead: Review Phase
    Lead->>WS: Read Proposed Approach
    alt Approach Approved
        Lead->>WS: Set Status: "plan_approved"
    else Revision Needed
        Lead->>WS: Set Status: "plan_revision_needed"
        Lead->>WS: Add revision feedback
        Worker->>WS: Revise approach
        Worker->>WS: Set Status: "plan_ready"
    end

    Note over Worker: Phase 2: Execute
    Worker->>WS: Detect plan_approved
    Worker->>Worker: Implement as planned
    Worker->>WS: Write structured handoff report
    Worker->>WS: Set Status: "complete"
    deactivate Worker
```

### 6.3 Reconciliation Loop

Automated validation and fix-task generation.

```mermaid
sequenceDiagram
    participant Maestro as Maestro
    participant Shell as Shell (execSync)
    participant WS as Workspace
    participant Lead as Engineering Lead

    Maestro->>Shell: reconcile("tsc --noEmit")
    Shell-->>Maestro: Exit code + stdout/stderr

    alt Exit Code 0 (PASS)
        Maestro->>WS: Log: "Reconcile PASSED"
        Maestro->>Maestro: Proceed to next wave
    else Exit Code != 0 (FAIL)
        Maestro->>WS: Create fix-task with error output
        Maestro->>WS: Append to status.md
        Maestro->>WS: Log: "Reconcile FAILED, fix-task created"
        Maestro->>Lead: delegate(fix-task)
        activate Lead
        Lead->>WS: Fix issues
        Lead->>WS: Status: complete
        deactivate Lead
        Maestro->>Shell: reconcile("tsc --noEmit") again
        Note over Maestro: Loop until PASS
    end
```

### 6.4 Real-time UI Update Flow and Chat-like Delegation View

The communication and delegation between agents is visualized to the user as a **chat-like interface**. Each delegation, status update, handoff report, and monitoring event appears as a message in a conversation thread -- making the multi-agent workflow as intuitive as reading a group chat. The developer sees the orchestrator's reasoning, lead reviews, worker progress updates, and reconciliation results as a continuous, chronological message stream with agent avatars, role badges, and color-coded team indicators.

This chat paradigm transforms the underlying file-based coordination (workspace/log.md, task files, status updates) into a familiar conversational UX:
- **Delegation messages** appear when the Maestro or a Team-Lead spawns a new agent ("Maestro delegated task-003 to Engineering Lead")
- **Status updates** surface when agents change task status (pending -> in_progress -> plan_ready -> plan_approved -> complete)
- **Handoff reports** render inline as structured message cards (Changes Made, Patterns Followed, Unresolved Concerns, Suggested Follow-ups)
- **Reconciliation results** show as pass/fail notifications with expandable error details
- **Plan-approval gates** present the worker's proposed approach as a reviewable message with approve/revise action buttons

```mermaid
sequenceDiagram
    participant Agent as Agent
    participant FS as File System
    participant FW as FileWatcher (Chokidar)
    participant WS as WebSocket Server
    participant Client as Web Client (Chat View)

    Agent->>FS: Write workspace/tasks/task-001.md

    FW->>FW: Detect change event
    FW->>FW: classifyFile() -> type: "task"
    FW->>FW: parseTaskFile() -> structured data

    FW->>WS: Emit "file:changed" {path, type, content, parsed}
    WS->>Client: Broadcast via WebSocket

    Client->>Client: Render as chat message<br/>(agent avatar, role badge,<br/>structured content card)

    Note over Client,WS: Parallel: Pane Output Streaming
    Client->>WS: subscribe:pane {paneId: "%5"}
    loop Every 2.5 seconds
        WS->>WS: tmux capture-pane -t %5
        WS->>Client: pane:output {paneId, content}
        Client->>Client: Render as live terminal<br/>embed within chat thread
    end
```

The chat view aggregates events from multiple sources (log.md entries, task file changes, status.md updates) into a unified conversation timeline, giving the developer a single pane of glass into the entire multi-agent workflow.

### 6.5 Training Pipeline Flow *[target]*

Reflection-based agent improvement after task completion.

```mermaid
sequenceDiagram
    participant Task as Completed Task
    participant TP as Training Pipeline
    participant MM as Mental Model Store
    participant XP as Score/XP Service (SQLite)
    participant UI as Web UI

    Task->>TP: Task status: complete

    Note over TP: 1. Collect Outcome Evidence
    TP->>TP: Reconcile results (pass/fail)
    TP->>TP: Handoff report quality score
    TP->>TP: Test pass/fail metrics

    Note over TP: 2. Generate Reflection Summary
    TP->>TP: Extract 1-3 learnings<br/>with context + confidence

    Note over TP: 3. Update Mental Model
    TP->>MM: Append patterns_learned<br/>(append-only, with confidence)

    Note over TP: 4. Calculate Skill Delta
    TP->>TP: Map evidence to skill dimensions<br/>(api-design, testing-strategy, etc.)

    Note over TP: 5. Record XP Event
    TP->>XP: XP = Base x Quality x<br/>Difficulty x Novelty x Integrity
    TP->>XP: Store skill_progress delta
    TP->>XP: Apply anti-gaming checks

    XP->>UI: Updated skill levels,<br/>XP progression
```

### 6.6 Wave-Based Parallel Execution

How the orchestrator schedules tasks in dependency waves.

```mermaid
graph LR
    subgraph Wave1 ["Wave 1 (No Dependencies)"]
        T1["task-001<br/>Requirements Analysis"]
        T2["task-002<br/>UX Research"]
    end

    subgraph Wave2 ["Wave 2 (Depends on Wave 1)"]
        T3["task-003<br/>API Design"]
        T4["task-004<br/>Frontend Scaffolding"]
    end

    subgraph Wave3 ["Wave 3 (Depends on Wave 2)"]
        T5["task-005<br/>Backend Implementation"]
        T6["task-006<br/>Frontend Integration"]
    end

    subgraph Reconcile ["Reconciliation"]
        R1["tsc --noEmit"]
        R2["npm test"]
    end

    subgraph Wave4 ["Wave 4 (Post-Reconcile)"]
        T7["task-007<br/>Security Review"]
        T8["task-008<br/>QA Testing"]
    end

    T1 --> T3
    T1 --> T4
    T2 --> T4
    T3 --> T5
    T4 --> T6
    T5 --> R1
    T6 --> R1
    R1 --> R2
    R2 --> T7
    R2 --> T8

    style Wave1 fill:#E8F5E9,stroke:#4CAF50
    style Wave2 fill:#E3F2FD,stroke:#2196F3
    style Wave3 fill:#FFF3E0,stroke:#FF9800
    style Reconcile fill:#FCE4EC,stroke:#F44336
    style Wave4 fill:#F3E5F5,stroke:#9C27B0
```

### 6.7 Session DAG Branching and Rewind (Level 1 Memory)

When a tool call fails or an agent reaches a dead end, the **SessionDAGManager** (Section 5.2.2) enables branching back to a stable checkpoint without polluting the main reasoning chain. This is a concrete runtime mechanism, not a future target.

```mermaid
sequenceDiagram
    participant Agent as Worker-Agent
    participant DAG as SessionDAGManager
    participant FS as memory/sessions/task-003.jsonl
    participant Tool as Tool (bash/edit)

    Note over Agent,DAG: Normal execution on main branch
    Agent->>DAG: append(msg-001, parent: null, "Implement auth")
    DAG->>FS: {"id":"msg-001","parentId":null,...}
    Agent->>DAG: append(msg-002, parent: msg-001, "Try approach A")
    DAG->>FS: {"id":"msg-002","parentId":"msg-001",...}
    Agent->>Tool: bash("npm test")
    Tool-->>Agent: EXIT 1: 5 tests failed

    Note over Agent,DAG: Tool failure detected → branch back
    Agent->>DAG: append(msg-003, parent: msg-002, "Tests failed: 5 errors")
    Agent->>DAG: rewind(to: msg-001)
    DAG->>DAG: Move leaf pointer to msg-001<br/>(msg-002, msg-003 preserved but inactive)

    Note over Agent,DAG: New branch from stable checkpoint
    Agent->>DAG: append(msg-004, parent: msg-001, "Try approach B")
    DAG->>FS: {"id":"msg-004","parentId":"msg-001",...}
    Agent->>Tool: bash("npm test")
    Tool-->>Agent: EXIT 0: all tests passed
    Agent->>DAG: append(msg-005, parent: msg-004, "Approach B succeeded")
```

**Key properties:**
- The DAG is append-only JSONL — failed branches are preserved for debugging/audit, never deleted
- Branch-back moves a pointer, it does not rewrite history
- Each agent instance has exactly one session DAG file: `memory/sessions/{task-id}.jsonl`
- On agent completion, the DAG is optionally archived or discarded based on retention policy

### 6.8 Silent Memory Flush (Pre-Compaction)

When an agent's context window approaches its token limit, the system triggers a **Silent Memory Flush** before compaction proceeds. This is a concrete lifecycle hook managed by the **DailyProtocolFlusher** (Section 5.2.2), tied to the `pre_compaction` event in the agent lifecycle state machine (Section 8.7).

```mermaid
sequenceDiagram
    participant Agent as Agent (Running)
    participant RT as Maestro Runtime
    participant Flusher as DailyProtocolFlusher
    participant FS as memory/daily/2026-04-05.md
    participant Compactor as Context Compactor

    Note over Agent,RT: Context approaching token limit
    RT->>RT: Detect context > 80% of budget
    RT->>Agent: Trigger pre_compaction hook

    Note over Agent,Flusher: Silent Memory Flush (invisible to user)
    Agent->>Agent: Internal turn: "Write durable<br/>knowledge to daily protocol"
    Agent->>Flusher: flush({findings, errors, decisions, file_paths})
    Flusher->>FS: Delta-append bullets with metadata:<br/>agent, confidence, timestamp, source task
    Flusher-->>Agent: NO_REPLY sentinel (silent turn ends)

    Note over Agent,Compactor: Compaction proceeds safely
    RT->>Compactor: Summarize conversation history
    Compactor->>Agent: Inject compressed context
    Agent->>Agent: Resume with summarized context<br/>(key knowledge preserved in L2)
```

**Lifecycle integration:** The `pre_compaction` hook is a mandatory step in the agent lifecycle. It fires between `Running` and the context compaction event. If the flush fails, compaction is deferred (retry on next monitoring cycle) rather than proceeding with potential knowledge loss.

---

## 7. Deployment View

The entire system runs on a single developer machine. Worker-Agents run in containers for security isolation; Team-Leads and Maestro use tmux panes for debuggability.

```mermaid
graph TB
    subgraph Machine ["Developer Machine (Linux/macOS)"]
        subgraph NodeProcess ["Node.js Process (port 3000)"]
            Express["Express Web Server"]
            WSS["WebSocket Server"]
            Chokidar["File Watcher (Chokidar)"]
        end

        subgraph TmuxSession ["tmux Session: agent-maestro"]
            Pane0["Pane 0: Maestro<br/>(Level 1, main agent)"]
            Pane1["Pane 1: Team-Lead<br/>(spawned dynamically)"]
        end

        subgraph ContainerRuntime ["Container Runtime (Docker/Podman)"]
            Container1["Container 1: Worker-Agent<br/>(isolated, resource-limited)"]
            Container2["Container 2: Worker-Agent<br/>(isolated, resource-limited)"]
            ContainerN["Container N: ...<br/>(up to spawn budget)"]
        end

        subgraph FileSystem ["Local File System"]
            WDir["workspace/<br/>goal.md, plan.md,<br/>status.md, log.md,<br/>tasks/"]
            ADir["agents/<br/>maestro.md,<br/>leads/*.md,<br/>workers/*.md"]
            MemDir["memory/<br/>sessions/*.jsonl (L1)<br/>daily/*.md (L2)<br/>agents/*/MEMORY.md,<br/>EXPERT.md (L3)<br/>knowledge-graph/**/*.md (L4)"]
            SDir["skills/<br/>*.md"]
            LogDir["logs/<br/>*.log"]
        end

        GitRepo["Git Repository<br/>(automated checkpoints,<br/>branch-per-worker,<br/>mem: commit convention)"]
    end

    subgraph External ["External Services"]
        GeminiAPI["Google Gemini API<br/>(HTTPS)"]
        ClaudeAPI["Anthropic Claude ACP<br/>(HTTPS, OAuth)"]
        NotebookLM["Google NotebookLM<br/>(Playwright browser automation)"]
    end

    NodeProcess -- "file I/O" --> FileSystem
    TmuxSession -- "file I/O" --> FileSystem
    TmuxSession -- "API calls" --> External
    ContainerRuntime -- "mounted volumes" --> FileSystem
    ContainerRuntime -- "API calls" --> External
    FileSystem -- "tracked by" --> GitRepo
    Chokidar -- "inotify/fsevents" --> FileSystem

    style Machine fill:none,stroke:#333,stroke-width:2px
    style NodeProcess fill:#E3F2FD,stroke:#2196F3
    style TmuxSession fill:#E8F5E9,stroke:#4CAF50
    style ContainerRuntime fill:#E8F5E9,stroke:#4CAF50
    style FileSystem fill:#FFF3E0,stroke:#FF9800
    style External fill:#FCE4EC,stroke:#F44336
```

### Infrastructure Decisions

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Hosting | Local developer machine | Privacy, latency, no cloud costs |
| Maestro/Lead isolation | tmux panes | Lightweight, attachable, debuggable; trusted agents on host |
| Worker isolation | Docker/Podman containers | Rootless containers with cgroup limits; least-privilege for untrusted execution |
| Web server | Express.js on port 3000 | Simple, well-known, sufficient for single-user local use |
| Real-time updates | WebSocket (ws library) | Full-duplex, low-latency file change notifications |
| File watching | Chokidar | Cross-platform, efficient (inotify on Linux, fsevents on macOS) |
| Agent runtime | Coding-agent framework (e.g., Pi) | Provides tool-use framework, extension system, session management |
| Memory persistence | File system (memory/ directory) | 4-level memory as Markdown/JSONL, git-trackable, human-readable |
| Memory versioning | Git (automated checkpoints) | `mem:` commit convention; branch-per-worker; merge-on-completion |
| Target: DB | SQLite | For XP/score/training history alongside file-based artifacts *[target]* |

---

## 8. Cross-cutting Concepts

### 8.1 File-based Coordination Protocol

All orchestration state flows through Markdown/YAML files in `workspace/`. This is the system's "message bus."

| File | Purpose | Writer | Reader |
|------|---------|--------|--------|
| `workspace/goal.md` | Session objective | Developer / run.sh | Maestro, all agents (via shared context) |
| `workspace/plan.md` | Execution strategy with phases | Planning Lead | Maestro, all agents |
| `workspace/status.md` | Task status table | Maestro, delegation engine | All agents, Web UI |
| `workspace/log.md` | Activity log (markdown table) | Logger (all tools) | All agents, Web UI |
| `workspace/tasks/task-NNN.md` | Individual task with handoff report | Worker-Agents (output), Maestro (creation) | Team-Leads (review), Web UI |

**Advantages:** Human-readable, git-trackable, crash-recoverable, no database needed.  
**Disadvantages:** No atomic transactions, no concurrent write protection, no query capability.

### 8.2 Agent Identity and Prompt Assembly

At delegation time, the Maestro (or any delegating Team-Lead) assembles a full system prompt by invoking the **PromptAssembler** component (Section 5.2.1), which orchestrates the **Memory Subsystem** (Section 5.2.2) to load the appropriate memory context. The pipeline is:

```
1. Agent body (agents/*.md -- system prompt without frontmatter)
2. Agent expertise -- Level 3 memory (memory/agents/{name}/MEMORY.md + EXPERT.md)
   Loaded by: ExpertiseStore (Section 5.2.2)
3. Knowledge graph branches -- Level 4 memory (memory/knowledge-graph/**/*.md)
   Loaded by: KnowledgeGraphLoader (Section 5.2.2)
   Selection: task domain tags matched against graph index; token-budgeted
4. Skills (skills/*.md -- concatenated with --- separators)
5. Shared context (shared-context/README.md + workspace state files)
6. Task description (from delegation parameters)
7. Plan-gate instructions (if plan_first: true)
8. Working directory path
9. Model tier assignment (from agent frontmatter model_tier policy, see Section 8.15)
```

**Knowledge graph branch selection:** The KnowledgeGraphLoader reads `memory/knowledge-graph/index.md`, matches the task's domain tags against graph node metadata, and returns only the relevant branches — keeping the injected context within the configured token budget (default: 2000 tokens for L4 content). This selective loading reduces prompt token waste by up to 67% compared to injecting the full knowledge base.

The assembled prompt is written to `memory/sessions/prompt-task-NNN.md` for auditability.

Source: `src/maestro.ts` — `assemblePrompt()` function

### 8.3 Skill Injection (Progressive Disclosure)

Skills are standalone Markdown documents in `skills/`. They are referenced by path in agent frontmatter and loaded at delegation time.

| Skill | File | Used By |
|-------|------|---------|
| API Design | `skills/api-design.md` | Backend Dev, Engineering Lead |
| Code Review | `skills/code-review.md` | Engineering Lead, Backend Dev, Frontend Dev |
| Security Audit | `skills/security-audit.md` | Security Reviewer, Validation Lead |
| Task Decomposition | `skills/task-decomposition.md` | Maestro |
| Testing Strategy | `skills/testing-strategy.md` | QA Engineer, Validation Lead |
| User Research | `skills/user-research.md` | UX Researcher |
| NotebookLM | `skills/notebooklm.md` | Maestro, all Team-Leads |

### 8.4 4-Level Agent Memory System

The memory system implements a **4-level architecture** inspired by human cognitive models and best practices from frameworks like OpenClaw, Pi, and the ACE-Framework. Each level serves a different temporal scope and access pattern, with **memory write permissions governed by the agent hierarchy** (Section 5.2.3).

**Memory Write Permissions by Hierarchy Level:**

| Level | Role | Memory Write Scope |
|-------|------|--------------------|
| Level 1 (Maestro) | Strategic overview, central project memory | Writes to all 4 memory levels; manages the central knowledge graph (Level 4); curates cross-team learnings |
| Level 2..n-1 (Team-Leads) | Domain strategy, expertise management | Write to Levels 1-3; manage domain-specific expertise files (`EXPERT.md`); read-only on other domains' expertise |
| Level n (Worker-Agents) | Atomic task execution | Write to Level 1 (own session context) and Level 2 (daily protocol contributions); deliver structured handoffs; no direct write access to Level 3/4 (learnings promoted by leads) |

#### Level 1: Active Session Context (Short-term / Ephemeral)

*   **Scope:** Single agent conversation / task execution
*   **Technique:** **JSONL-based DAG (Directed Acyclic Graph)**
*   **Details:** Each message receives an `id` and a `parentId`, enabling **in-place branching**. When a tool call fails, the agent can rewind to a stable checkpoint ("branch back") without polluting the main context with error noise. The DAG structure tracks the reasoning tree, not just a flat transcript.
*   **Format:** Serialized append-only JSONL for crash safety -- no data loss on process termination.
*   **Lifecycle:** Created at agent spawn, discarded (or archived to Level 2) at agent completion.

```jsonl
{"id":"msg-001","parentId":null,"role":"system","content":"...","ts":"2026-04-05T10:00:00Z"}
{"id":"msg-002","parentId":"msg-001","role":"assistant","content":"...","ts":"2026-04-05T10:00:05Z"}
{"id":"msg-003","parentId":"msg-002","role":"tool","tool":"bash","content":"...","ts":"2026-04-05T10:00:10Z"}
{"id":"msg-004","parentId":"msg-002","role":"assistant","content":"...branch: retry","ts":"2026-04-05T10:00:15Z"}
```

#### Level 2: Daily Protocols & Scratchpad (Episodic / Mid-term)

*   **Scope:** Cross-session within a single day / sprint
*   **Technique:** Automated Markdown protocols (`YYYY-MM-DD.md`) in `memory/daily/`
*   **Details:** Before every **context compaction** (summarization of the chat history), each agent performs a **"Silent Memory Flush"**: important findings, file paths, error patterns, and key decisions are written to the daily protocol *before* the detailed conversation history is truncated.
*   **Update strategy:** **Incremental delta updates** only. Instead of rewriting the protocol, new bullets are appended with metadata (usefulness counter, source agent, confidence). This prevents context collapse from monolithic overwrites.
*   **Lifecycle:** Created per day, retained for configurable duration (default: 30 days), then archived or pruned.

```markdown
# Daily Protocol: 2026-04-05

## Findings
- [10:15] (backend-dev, confidence: 0.9) Auth token validation must check `exp` field before processing -- discovered during task-003
- [11:30] (engineering-lead, confidence: 0.85) API rate limiter config lives in `src/middleware/rate-limit.ts`, not in env vars

## Error Patterns
- [10:45] (backend-dev) `tsc --noEmit` fails on circular import: auth.ts <-> user.ts -- resolved by extracting shared types to types/auth.ts

## Decisions
- [12:00] (maestro) Wave 3 postponed until rate limiter fix confirmed via reconciliation
```

#### Level 3: Long-term Memory & Expertise (Semantic / Instructional)

*   **Scope:** Persistent across all sessions -- curated knowledge
*   **Technique:** Role-specific Markdown files: `MEMORY.md` (per-agent learnings) and `EXPERT.md` (domain expertise)
*   **Details:** Contains curated decisions, coding standards, architecture patterns, and proven heuristics. Stored as structured Markdown with YAML frontmatter and `schema_version` for migration safety. Two files per agent: `MEMORY.md` (per-agent learnings) and `EXPERT.md` (domain expertise).
*   **Domain Locking (enforced by MemoryAccessControl):** Only the designated domain expert (e.g., the DevOps Team-Lead) has write access to their `EXPERT.md`. Other agents read these files but cannot modify them. The **MemoryAccessControl** component (Section 5.2.2) denies unauthorized writes at runtime. This prevents **knowledge drift** from less capable Worker-Agent models overwriting curated expertise.
*   **Append-only with confidence:** Entries carry confidence scores (0.0-1.0) and are never deleted in-place. Low-confidence entries (< 0.3) are archived by the **ExpertiseStore** component during periodic compaction (configurable interval, default: weekly).
*   **Structured categories:** `Preferences`, `Patterns Learned`, `Strengths`, `Mistakes to Avoid`, `Collaborations`.

Updated via the `update_memory` tool in `src/maestro.ts`, which delegates to the **ExpertiseStore** component.

#### Level 4: Structured Knowledge Graph / Deep DAG (Persistent Knowledge)

*   **Scope:** Project-wide, cross-agent -- the organizational memory
*   **Technique:** **Hierarchical knowledge graph in Markdown** -- a structured mind-map replacing classical RAG
*   **Details:** Instead of searching through billions of tokens blindly, the system maintains a hierarchical graph of project states, architectural decisions, and cross-cutting patterns. The Maestro is the primary curator of this knowledge graph. Only relevant "branches" of the graph are loaded into an agent's context at delegation time -- reducing token waste by up to 67% compared to flat context injection.
*   **Structure:** The graph is organized as a tree of interconnected Markdown files in `memory/knowledge-graph/`, with a root `index.md` that links to domain subtrees (backend, frontend, devops, security, etc.).
*   **Write access:** Maestro has full write access. Team-Leads can propose additions via structured handoffs. Worker-Agents contribute indirectly through their handoff reports, which leads and the Maestro distill into graph updates.

```markdown
# Knowledge Graph: Agent Maestro Project

## Architecture
- [API Design](api-design.md) -- REST conventions, versioning strategy
- [Auth System](auth-system.md) -- Token flow, session management
- [Database](database.md) -- Schema patterns, migration strategy

## Patterns
- [Error Handling](error-handling.md) -- Cross-cutting error conventions
- [Testing Strategy](testing-strategy.md) -- Unit/integration/e2e approach

## Decisions
- [ADR Index](decisions/index.md) -- Architecture decision records with context
```

#### Memory Level Summary

```mermaid
graph TB
    subgraph MemorySystem ["4-Level Agent Memory System"]
        L1["<b>Level 1: Active Session Context</b><br/><i>Ephemeral / Short-term</i><br/>JSONL DAG with branching<br/>Per-agent, per-task<br/>Discarded on completion"]

        L2["<b>Level 2: Daily Protocols</b><br/><i>Episodic / Mid-term</i><br/>YYYY-MM-DD.md with delta updates<br/>Silent Memory Flush before compaction<br/>Retained ~30 days"]

        L3["<b>Level 3: Long-term Memory</b><br/><i>Semantic / Instructional</i><br/>MEMORY.md + EXPERT.md per agent<br/>Domain-locked write access<br/>Append-only with confidence scores"]

        L4["<b>Level 4: Knowledge Graph</b><br/><i>Persistent / Structural</i><br/>Hierarchical Markdown mind-map<br/>Maestro-curated, cross-agent<br/>Selective branch loading into context"]
    end

    L1 -- "Silent Memory Flush<br/>(before compaction)" --> L2
    L2 -- "Promoted learnings<br/>(by Team-Leads)" --> L3
    L3 -- "Distilled patterns<br/>(by Maestro)" --> L4
    L4 -- "Selective branch loading<br/>(at delegation time)" --> L1

    style MemorySystem fill:none,stroke:#438DD5,stroke-width:2px
    style L1 fill:#FFCCBC,color:#000
    style L2 fill:#FFE0B2,color:#000
    style L3 fill:#C8E6C9,color:#000
    style L4 fill:#BBDEFB,color:#000
```

### 8.5 Security, Isolation, and Input Sanitization

Security isolation follows a **tiered model** aligned with the agent hierarchy:

| Agent Level | Runtime Isolation | File System Access | Memory Access | Rationale |
|-------------|-------------------|-------------------|---------------|-----------|
| **Maestro (L1)** | tmux pane on host | Full workspace + memory (all levels) | Read/write all 4 levels | Trusted root agent; needs full visibility for orchestration |
| **Team-Leads (L2..n-1)** | tmux pane on host | Workspace + own domain files + memory (L1-L3) | Write L1-L2; write own domain L3; read-only other L3/L4 | Trusted for domain; debuggable via tmux attach |
| **Worker-Agents (Ln)** | **Container (Docker/Podman)** with cgroup resource limits (CPU, memory, disk) | Mounted volume: task directory + own memory/sessions/ only | Write L1-L2 only; no L3/L4 write access | Least-privilege; untrusted code execution; resource-limited to prevent runaway consumption |

**Security controls:**

| Concern | Mechanism | Details |
|---------|-----------|---------|
| **Process isolation** | Container runtime for Workers; tmux for Leads/Maestro | Workers run in rootless Podman/Docker containers with cgroup limits. The **RuntimeManager** (Section 5.1) selects the runtime based on agent hierarchy level. Dev-mode fallback: all agents in tmux. |
| **File access control** | Domain whitelist in agent frontmatter + runtime enforcement | The `domain` field in frontmatter defines allowed read/upsert/delete path patterns. Enforced by intercepting file operations at the tool-call layer (pre-execution hook). Deny-by-default. |
| **Memory access control** | MemoryAccessControl component (Section 5.2.2) | Enforces write permissions by hierarchy level. Workers blocked from writing L3/L4. Team-Leads blocked from writing other domains' EXPERT.md. All denials logged. |
| **Shell injection** | Control character stripping + session ID validation | All shell-bound input is sanitized before execution. tmux session IDs validated against allowlist. |
| **Secret protection** | OS keychain integration + secret-aware logging | OAuth tokens stored in OS keychain, never in workspace files. Logger redacts known secret patterns from all output. |
| **Web server auth** | Bind to localhost + session-bound tokens | Express server binds to 127.0.0.1 only. Session-based authentication tokens with configurable lifetime. Rate limiting on API endpoints. |
| **Prompt injection** | System/user content separation + sanitization | System prompt sections (policy/rules) separated from user content by structural delimiters. Retrieved workspace content sanitized before injection into agent prompts. |

### 8.6 Observability

| Layer | Current | Target |
|-------|---------|--------|
| Activity logging | `workspace/log.md` (markdown table with timestamps) | Correlation IDs per delegation chain |
| Per-agent logs | `logs/{agent-slug}.log` (piped from Pi stdout/stderr) | Structured JSON logs with API observations |
| Real-time monitoring | WebSocket broadcast of file changes | SSE endpoint with heartbeat (polling-first, push later) |
| Pane output streaming | `tmux capture-pane` polled every 2.5s via WebSocket | Direct terminal WebSocket (ttyd or node-pty) |
| Task tracking | `workspace/status.md` table + individual task files | Dashboard with filters, search, completion metrics |
| Training/XP tracking | Not implemented | XP event ledger with evidence links (SQLite) *[target]* |

### 8.7 Agent Lifecycle State Machine

Every agent instance follows a well-defined lifecycle. Understanding this state machine is essential for monitoring, debugging, and implementing proper cleanup.

```mermaid
stateDiagram-v2
    [*] --> Initializing: delegate() called
    Initializing --> PromptAssembly: Agent resolved, config loaded,\nL3 expertise + L4 graph loaded
    PromptAssembly --> Spawning: Prompt assembled,\nwritten to memory/sessions/
    Spawning --> Running: Runtime created\n(tmux pane or container),\nSession DAG initialized (L1)
    Running --> Flushing: Context > 80% budget\n(pre_compaction hook)
    Flushing --> Running: Silent Memory Flush\ncomplete (L1→L2),\nNO_REPLY sentinel
    Running --> PlanReady: Worker sets\nstatus: plan_ready
    PlanReady --> Running: Lead approves\n(plan_approved)
    PlanReady --> PlanRevision: Lead requests\nrevision
    PlanRevision --> PlanReady: Worker revises
    Running --> Complete: Task finished,\nhandoff report written
    Running --> Failed: Unrecoverable error,\ntimeout, or crash
    Running --> Stalled: No output for\n> stall_timeout
    Stalled --> Running: Activity resumes
    Stalled --> Failed: Escalation timeout\nexceeded
    Complete --> MemoryPromotion: Flush L1→L2,\nGit checkpoint
    MemoryPromotion --> Reflecting: Training pipeline\ntriggers reflection
    Reflecting --> [*]: L3 updated,\nXP recorded
    MemoryPromotion --> [*]: No training pipeline
    Failed --> [*]: Error logged,\nparent notified,\nL1 archived

    note right of Flushing
        DailyProtocolFlusher
        writes to memory/daily/
        See Section 6.8
    end note

    note right of Stalled
        Detected by monitor tool
        via output polling
    end note
```

**Lifecycle invariants:**
- Every agent that reaches `Spawning` must eventually reach either `Complete` or `Failed` -- no silent disappearance
- **`Flushing`** is a mandatory transition triggered by the `pre_compaction` hook when context exceeds 80% of token budget. The **DailyProtocolFlusher** writes to Level 2; if flush fails, compaction is deferred
- **`MemoryPromotion`** is a mandatory transition on `Complete`: Level 1 session is flushed to Level 2, and the **GitCheckpointEngine** creates a `mem:` commit
- The `monitor` tool is responsible for detecting `Stalled` agents (no new output within configurable `stall_timeout`, default: 120 seconds)
- On `Failed`, the parent agent receives the error context and can decide to retry, reassign, or escalate
- Runtime cleanup (tmux pane or container teardown) happens on terminal states (`[*]`)

**Status determination priority cascade:** When the `monitor` tool checks an agent, it evaluates conditions in strict priority order -- each step falls through gracefully on failure, preserving the current status rather than corrupting state:

1. Runtime alive check (tmux pane exists and process running)
2. Agent activity detection (new output since last poll)
3. Task status file check (status field in task markdown)
4. Stall detection (no activity within `stall_timeout`)

**Target: Session recovery classification** *[target]*: Classify sessions as `live` (running normally), `dead` (pane gone, workspace intact -- recoverable), `partial` (workspace damaged -- escalate), or `unrecoverable` (both gone -- cleanup only). Each classification maps to an action: recover, cleanup, escalate, or skip.

### 8.8 Timeout, Deadlock Detection, and Stall Recovery

Multi-agent systems are susceptible to hangs, deadlocks, and silent failures. The system implements layered detection:

| Layer | Mechanism | Default | Action |
|-------|-----------|---------|--------|
| **Agent stall detection** | `monitor` tool polls tmux `capture-pane`; no new output within `stall_timeout` | 120s | Log warning, send nudge message to agent |
| **Task timeout** | Per-task `time_budget` in delegation parameters | 600s | Parent receives timeout notification; can kill and reassign |
| **Wave timeout** | Maximum wall-clock time for all tasks in a wave to complete | 1800s | Maestro kills remaining agents, creates summary of partial results, decides whether to proceed or abort |
| **Process health check** | tmux `has-session` / pane existence check | 10s interval | Detect crashed agents; mark as `Failed`, notify parent |
| **Recursive depth guard** | Configurable `max_delegation_depth` in system config | 5 levels | Agents at max depth cannot use `delegate` tool; prevents runaway recursion |
| **Spawn budget** | Maximum concurrent tmux panes per session | 10 panes | New delegation requests queued until a pane becomes available |

**Bounded retry with escalation:** When an agent encounters a transient failure (e.g., LLM timeout, tool error), the system tracks retry attempts per `(taskId, errorType)`. Escalation triggers when `attempts > maxRetries` (default: 3) or elapsed time exceeds `escalateAfter` duration (default: 300s). Escalation actions: notify parent agent, notify developer via UI, or abort task. Failed retries allow another attempt on the next monitoring cycle without immediate escalation.

**Deadlock prevention:**
- Wave-based scheduling inherently prevents circular dependencies (all wave N tasks are independent)
- Within a wave, agents do not wait on each other -- they write to separate task files and the orchestrator monitors completion
- Cross-wave dependencies are explicit in the task graph and resolved by wave ordering

### 8.9 Resource Management and Backpressure

Running many concurrent LLM-powered agents can exhaust system resources (CPU, memory, API rate limits, tmux panes). The system implements backpressure at multiple levels:

| Resource | Limit | Backpressure Strategy |
|----------|-------|-----------------------|
| **tmux panes** | Configurable max (default: 10) | Queue pending delegations; start next when a pane frees up |
| **LLM API calls** | Provider rate limits | Per-provider token bucket with exponential backoff; failover to alternate provider |
| **File system I/O** | Local disk throughput | Wave-based scheduling naturally batches I/O; no additional throttling needed |
| **Memory (agent prompts)** | ~50-200K tokens per agent context | Context window management (see 8.10); mental model size monitoring |
| **Disk (workspace artifacts)** | Local disk space | Log rotation for `logs/*.log`; configurable artifact retention policy *[target]* |

**Spawn queuing:** When the active pane count reaches the configured maximum, new `delegate()` calls enter a FIFO queue. The Maestro processes the queue as agents complete, prioritizing by wave order then task priority. This prevents resource exhaustion while maintaining fairness.

### 8.10 Context Window Management

LLM context windows are a finite and expensive resource. As agent hierarchies deepen and mental models grow, managing token budgets becomes critical to maintaining reasoning quality.

**Token budget allocation:**

| Prompt Component | Typical Size | Priority | Management Strategy |
|-----------------|-------------|----------|---------------------|
| Agent system prompt body | 500-2000 tokens | Fixed | Static, authored by developer |
| Mental model | 200-5000 tokens (grows) | High | Confidence-based pruning when exceeding budget *[target]* |
| Skills (injected) | 500-3000 tokens per skill | Medium | Progressive disclosure -- only load skills relevant to current task |
| Shared context (goal, plan, status) | 500-2000 tokens | High | Always included; summarized if oversized |
| Task description | 200-1000 tokens | Critical | Always included in full |
| Plan-gate instructions | 100-300 tokens | Conditional | Only when `plan_first: true` |
| **Total target** | **< 8000 tokens** | | Leaves maximum room for LLM reasoning and tool calls |

**Strategies for controlling context growth:**
1. **Expertise pruning**: When an agent's `MEMORY.md` or `EXPERT.md` exceeds a configurable token budget (default: 3000 tokens), the **ExpertiseStore** component archives entries with the lowest confidence scores to `memory/agents/{name}/archive/` rather than deleting them.
2. **Skill progressive disclosure**: Only skills listed in the agent's frontmatter are loaded. Within those, only the subset relevant to the current task type is injected (matched by skill metadata tags).
3. **Shared context summarization**: If `workspace/plan.md` or `workspace/status.md` exceed 2000 tokens, a summarized version is injected with a pointer to the full file.
4. **Sub-agent context isolation**: Each sub-agent receives a fresh context window with only the information relevant to its specific task. Parent context is not inherited wholesale -- only the task description and relevant shared context are passed down. This prevents "context rot" where deep hierarchies accumulate irrelevant information.

### 8.11 Concurrent File Access and Conflict Resolution

Multiple agents writing to shared workspace files (especially `status.md` and `log.md`) is a known risk (see Risk #4). The system uses a layered conflict prevention strategy:

| Strategy | Scope | Mechanism |
|----------|-------|-----------|
| **Single-writer convention** | `goal.md`, `plan.md` | Only one designated agent writes each file (goal: developer/run.sh; plan: Planning Lead) |
| **Append-only protocol** | `log.md`, mental models | Agents only append; no reads-modify-writes. File append is atomic on most OS/filesystem combinations for reasonable line lengths |
| **Task file ownership** | `tasks/task-NNN.md` | Each task file has exactly one assigned agent as writer; the lead reads for review |
| **Status table locking** | `status.md` | The Maestro is the sole writer of the status table. Agents update their own task files; the Maestro reflects status changes into `status.md` during monitoring sweeps |
| **Domain path restrictions** | Agent frontmatter | `domain.upsert` patterns restrict which file paths each agent can write to, preventing accidental cross-agent file conflicts |
| **Wave isolation** | Cross-wave artifacts | Agents in different waves operate on different artifacts by design (wave ordering ensures predecessors complete before dependents start) |

**Atomic file writes** *[target]*: For critical state files (`status.md`, `log.md`), use the write-tmp-then-rename pattern: write to a temporary file in the same directory, then atomically rename to the target path. This prevents partial writes from corrupting state if a process crashes mid-write.

**Target enhancement** *[target]*: File-level advisory locking using `flock()` or a lightweight lock manager for the remaining edge cases (e.g., two agents in the same wave writing to an overlapping path). Symbol-level locking (AST-aware, as in the Wit protocol) for shared source code files.

### 8.12 Error Recovery and Resilience

The system implements defense-in-depth for fault tolerance:

| Scenario | Recovery Mechanism | Details |
|----------|-------------------|---------|
| **Maestro crash** | tmux sessions and containers survive; agent processes continue independently | Agents write their results to workspace files regardless of Maestro state. On restart, Maestro reads current state from files. |
| **Maestro session resume** | `run.sh --resume` re-attaches to existing tmux session | Reads `status.md` + task files to reconstruct `ActiveWorkers` map; resumes monitoring from current wave state |
| **Agent crash (mid-task)** | Health check detects missing pane; parent notified | Parent agent can retry (re-delegate same task), reassign (delegate to different agent), or escalate (mark task as failed, create summary of partial progress) |
| **LLM provider failure** | Failover chain with exponential backoff | Primary model -> secondary model -> tertiary model. Per ADR-007. Retry with backoff before failover. If all providers fail, task enters `Failed` state with clear error context. |
| **Runtime unavailable** | tmux: fallback to `nohup` background process. Container: fallback to tmux pane | Loses isolation guarantees but maintains core execution. Agent logs piped to `logs/` directory. |
| **Agent spawn failure** | Error returned to Maestro/Team-Lead; can retry or reassign | Common causes: tmux pane limit reached (queue and retry), agent definition not found (fail fast with clear error), LLM auth failure (prompt user) |
| **Reconcile failure** | Auto-creates fix-task; loops until validation passes | Maximum retry count (default: 3) prevents infinite loops. After max retries, escalates to user with full error context. |
| **File corruption** | Workspace files are git-trackable; recovery via git checkout | `workspace/` should be committed at wave boundaries for checkpoint/restore capability |
| **Stalled agent** | Timeout detection escalation: nudge -> kill -> reassign | See Section 8.8 for timeout ladder |
| **Target: Session restore** *[target]* | Differentiate "not restorable" (409) vs "workspace missing" (422) | Explicit error classification enables appropriate UI responses |
| **Target: Write-ahead queue** *[target]* | Task queue persisted to disk before execution | Enables checkpoint/restart: on crash, replay queue from last completed task rather than restarting entire session |

### 8.13 Chat-like Visualization of Agent Communication

The multi-agent orchestration process -- delegations, status transitions, handoff reports, plan approvals, and reconciliation results -- is presented to the user as a **chat-like interface**. Rather than requiring the developer to inspect raw workspace files, log tables, or tmux panes individually, the Web Client aggregates all agent activity into a unified, chronological conversation thread.

**Design rationale:** A chat paradigm is the natural metaphor for a hierarchical tree of agents communicating through structured messages. It maps directly to how the system works: parent agents "talk to" their sub-agents at any depth, and each response is a structured artifact (task assignment, proposed approach, handoff report, reconcile result). Visualizing this as a threaded conversation tree makes the underlying coordination immediately legible, regardless of how many levels deep the hierarchy goes.

**Message types in the chat view:**

| Event | Rendered As | Source |
|-------|------------|--------|
| Delegation | "Maestro delegated task-003 to Engineering Lead" with task card | `workspace/log.md` entry + task file creation |
| Status change | Status badge update (pending -> in_progress -> complete) | `workspace/status.md` change |
| Plan-approval gate | Proposed approach card with approve/revise buttons | Task file `plan_ready` status |
| Handoff report | Structured card (Changes / Patterns / Concerns / Follow-ups) | Task file `## Output` section |
| Reconciliation | Pass/fail notification with expandable error output | `reconcile` tool result |
| Memory update | Learning summary with confidence indicator | `update_memory` tool result |
| Monitoring check-in | Agent activity snapshot with pane output excerpt | `monitor` tool result |

Each message carries the agent's **avatar**, **role badge** (Maestro / Team-Lead / Worker-Agent), and **team color** (from `multi-team-config.yaml`), making it immediately clear who is communicating with whom and at which hierarchy level.

### 8.14 Domain Model

The following entity-relationship diagram captures the core domain concepts and their relationships. This model underpins all coordination, training, and gamification features.

```mermaid
erDiagram
    AGENT_DEFINITION {
        string name PK
        string model
        string expertise_path
        string[] skills
        json tool_permissions
        json domain_restrictions
        string system_prompt_body
    }

    AGENT_INSTANCE {
        string instance_id PK
        string agent_name FK
        string tmux_pane_id
        string task_id FK
        string status
        datetime started_at
        int delegation_depth
    }

    SESSION_CONTEXT {
        string context_id PK
        string agent_instance_id FK
        string format "JSONL DAG"
        string file_path
        int message_count
        string memory_level "Level 1"
    }

    DAILY_PROTOCOL {
        string date PK
        string file_path
        json findings
        json error_patterns
        json decisions
        string memory_level "Level 2"
    }

    MENTAL_MODEL {
        string agent_name FK
        datetime updated
        json preferences
        json patterns_learned
        json strengths
        json mistakes_to_avoid
        json collaborations
    }

    SKILL {
        string skill_id PK
        string file_path
        string domain
        string[] tags
    }

    TEAM {
        string team_name PK
        string lead_agent FK
        string[] worker_agents
        string color
    }

    TASK {
        string task_id PK
        string title
        string description
        string assigned_to FK
        string status
        int wave_number
        string[] dependencies
        string parent_task FK
        json handoff_report
    }

    WORKSPACE_STATE {
        string file_path PK
        string type
        text content
        datetime last_modified
    }

    SESSION {
        string session_id PK
        string tmux_session_name
        string goal
        datetime started_at
        string status
        int max_depth
        int max_panes
    }

    TRAINING_RUN {
        string run_id PK
        string agent_name FK
        string task_id FK
        json outcome_evidence
        json reflection_summary
        json skill_deltas
        datetime completed_at
    }

    XP_EVENT {
        string event_id PK
        string agent_name FK
        string task_id FK
        float base_xp
        float quality_multiplier
        float difficulty_multiplier
        float novelty_multiplier
        float integrity_flag
        float total_xp
        json evidence_refs
    }

    KNOWLEDGE_GRAPH {
        string node_id PK
        string domain
        string file_path
        json linked_nodes
        string curator_agent FK
        datetime last_updated
        string memory_level "Level 4"
    }

    AGENT_DEFINITION ||--o{ AGENT_INSTANCE : "spawns"
    AGENT_DEFINITION ||--|| MENTAL_MODEL : "has (Level 3)"
    AGENT_DEFINITION ||--o{ SKILL : "uses"
    AGENT_INSTANCE ||--|| SESSION_CONTEXT : "owns (Level 1)"
    AGENT_INSTANCE ||--o{ DAILY_PROTOCOL : "contributes to (Level 2)"
    MENTAL_MODEL ||--o{ KNOWLEDGE_GRAPH : "distilled into (Level 4)"
    TEAM ||--|| AGENT_DEFINITION : "led by"
    TEAM ||--o{ AGENT_DEFINITION : "includes"
    SESSION ||--o{ AGENT_INSTANCE : "contains"
    SESSION ||--o{ TASK : "contains"
    TASK ||--o{ TASK : "depends on"
    TASK ||--|| AGENT_INSTANCE : "assigned to"
    TASK ||--o| TRAINING_RUN : "triggers"
    TRAINING_RUN ||--o| XP_EVENT : "produces"
    TRAINING_RUN ||--|| MENTAL_MODEL : "updates"
```

**Key domain invariants:**
- An `AGENT_DEFINITION` is static configuration; an `AGENT_INSTANCE` is a running process
- A `TASK` belongs to exactly one wave and has at most one assigned agent instance
- `MENTAL_MODEL` (Level 3) is append-only -- updates add entries, never remove
- `SESSION_CONTEXT` (Level 1) is ephemeral -- discarded or archived to `DAILY_PROTOCOL` (Level 2) on agent completion
- `KNOWLEDGE_GRAPH` (Level 4) nodes are write-accessible only by the Maestro; Team-Leads propose additions via handoffs
- `DAILY_PROTOCOL` (Level 2) entries are append-only with delta updates -- no monolithic rewrites
- `XP_EVENT` requires non-null `evidence_refs` (evidence-gating invariant)
- `SESSION` has configurable `max_depth` and `max_panes` limits enforced at delegation time

### 8.15 Configuration Management and Model Tiering

System configuration follows a layered model with clear precedence:

| Layer | File | Scope | Override Precedence |
|-------|------|-------|---------------------|
| **System defaults** | Hardcoded in `src/maestro.ts` | Timeouts, max panes, wave limits, model tier defaults | Lowest |
| **Project config** | `multi-team-config.yaml` | Team structure, agent assignments, paths, model tier policy | Medium |
| **Agent config** | `agents/*.md` frontmatter | Per-agent model, model_tier, skills, tools, memory permissions, domain | High |
| **Session config** | CLI args to `run.sh` | Goal, resume flag, overrides | Highest |

**Configuration validation:** At startup, `loadConfig()` validates via Zod schemas:
- All referenced agent files exist and have valid frontmatter (including `schema_version`)
- All referenced skill files exist
- Team-Leads have the `delegate` tool enabled
- No circular team references
- Model identifiers are recognized provider/model pairs
- Memory `write_levels` are consistent with hierarchy level (Workers cannot have L3/L4 write access)
- `model_tier` is valid and consistent with agent role
- Cross-field constraint: if `delegate: true`, agent must reference at least one potential sub-agent

**Model Tiering Policy:**

Model tiering ensures that expensive, high-reasoning models are used for memory curation and strategic decisions, while cost-effective models handle atomic task execution. This is enforced via the `model_tier` field in agent frontmatter:

| Tier | Purpose | Default Model | Used By | Rationale |
|------|---------|---------------|---------|-----------|
| **curator** | Memory curation (L3/L4), knowledge graph maintenance, reflection | Opus 4.6 / Gemini 2.5 Pro | Maestro, Training Pipeline | Curating knowledge requires highest reasoning quality; errors propagate across all agents |
| **lead** | Domain strategy, plan review, quality gates, L2→L3 promotion | Opus 4.6 / Gemini 2.5 Pro | Team-Leads | Reviewing and synthesizing requires strong reasoning; cheaper than curator for focused domains |
| **worker** | Atomic task execution, code generation, testing | Sonnet 4.6 / Haiku 4.5 / Gemini 2.5 Flash | Worker-Agents | Well-defined tasks with clear instructions; high throughput more important than peak reasoning |

**Tier selection at runtime:** The **PromptAssembler** (Section 5.2.1) reads the agent's `model_tier` from frontmatter and resolves it to a concrete model ID via the project config's `model_tier_policy` section:

```yaml
# In multi-team-config.yaml
model_tier_policy:
  curator:
    primary: "anthropic/claude-opus-4-6"
    fallback: "google/gemini-2.5-pro"
  lead:
    primary: "anthropic/claude-opus-4-6"
    fallback: "google/gemini-2.5-pro"
  worker:
    primary: "anthropic/claude-sonnet-4-6"
    fallback: "google/gemini-2.5-flash"
```

### 8.16 Logging and Audit Trail

The system maintains multiple log layers for different audiences:

| Log Layer | Location | Format | Audience | Retention |
|-----------|----------|--------|----------|-----------|
| **Activity log** | `workspace/log.md` | Markdown table (timestamp, agent, message) | Developer, all agents | Per-session |
| **Agent stdout/stderr** | `logs/{agent-slug}.log` | Raw terminal output | Developer (debugging) | Per-session |
| **Task handoff reports** | `workspace/tasks/task-NNN.md` | Structured markdown (4 sections) | Lead agents, developer | Per-session |
| **Session prompts** | `memory/sessions/prompt-task-NNN.md` | Full assembled prompt | Auditing, debugging | Per-session |
| **Session DAGs** | `memory/sessions/task-NNN.jsonl` | JSONL DAG (Level 1 memory) | Debugging, time-travel | Per-session (archivable) |
| **Daily protocols** | `memory/daily/YYYY-MM-DD.md` | Episodic memory (Level 2) | Cross-session learning | 30-day retention |
| **Memory commits** | Git log (`mem:` prefix) | Memory evolution audit trail | Developer, architecture review | Persistent |
| **Target: Structured events** *[target]* | SQLite `events` table | JSON with correlation IDs | Training pipeline, XP service | Persistent |

**Correlation:** Each delegation chain is traceable via task IDs: `task-001` delegates to `task-003` which creates `task-003-fix-001`. The `log.md` entries reference task IDs, enabling full chain reconstruction.

**Target: Correlation IDs** *[target]*: Each delegation will carry a `correlation_id` that propagates through all log entries, task files, and API observations in that delegation subtree. This enables filtering all activity for a specific delegation chain.

### 8.17 Git-Memory Integration ("Marriage with Git")

The memory system (Section 8.4) is tightly integrated with Git to make agent decisions **auditable, versionable, and recoverable**. All memory artifacts (Levels 2-4) are treated as first-class repository content.

| Principle | Implementation | Details |
|-----------|---------------|---------|
| **Filesystem-as-Context** | Memory files in `memory/` directory within the repository | All memory artifacts (daily protocols, MEMORY.md, EXPERT.md, knowledge graph) are plain Markdown/YAML files that Git tracks natively. The workspace is the "Source of Truth" -- no external database for memory state. |
| **Automated Checkpoints** | Git hooks (`post-turn`) trigger memory commits | After each successful agent step (task completion, reconciliation pass, wave boundary), a commit captures the current memory state. This provides fine-grained rollback capability. |
| **Conventional Memory Commits** | Prefixed commit messages for memory operations | Memory updates follow a naming convention: `mem: update backend patterns`, `mem: daily protocol 2026-04-05`, `mem: knowledge graph -- auth system`. This enables filtering memory changes via `git log --grep="^mem:"`. |
| **Branch-based Memory Isolation** | Worker-Agents operate on feature branches | Each Worker-Agent's local memory (Level 1-2) lives on its isolated feature branch. Memory is only integrated into the Maestro's central knowledge graph (Level 4) upon successful merge -- preventing half-finished learnings from polluting the project memory. |
| **Audit Trail** | Human-reviewable via `git diff` | Since all memory is readable Markdown, a human reviewer can trace exactly which heuristics, patterns, or expertise the agents learned over time: `git diff HEAD~5 -- memory/` shows the last 5 memory evolution steps. |

**Memory-aware Git workflow:**

```mermaid
sequenceDiagram
    participant Worker as Worker-Agent (feature branch)
    participant Lead as Team-Lead
    participant Maestro as Maestro (main branch)
    participant Git as Git Repository

    Worker->>Git: mem: daily findings (task-003)
    Worker->>Lead: Handoff report with learnings

    Lead->>Lead: Review & curate learnings
    Lead->>Git: mem: update EXPERT.md (backend patterns)

    Lead->>Maestro: Merge request (feature -> main)
    Maestro->>Maestro: Distill cross-team patterns
    Maestro->>Git: mem: knowledge graph -- auth system updated
    Note over Git: Full audit trail via git log --grep="^mem:"
```

### 8.18 Memory Best Practices

These operational guidelines ensure the memory system remains effective, consistent, and safe across the agent hierarchy.

| Practice | Description | Rationale |
|----------|-------------|-----------|
| **Incremental delta updates** | Always append new entries; never rewrite memory files monolithically | Prevents context collapse and data loss. Atomic appends are safe under concurrent access. |
| **Security isolation** | Worker-Agents execute in Docker sandboxes *[target]*; only Team-Leads and Maestro manage persistent memory on the host filesystem | Prevents untrusted or lower-capability Worker models from corrupting curated knowledge. |
| **Model tiering for memory curation** | Use expensive models (Opus 4.6) for memory curation (Reflector/Curator roles); use cost-effective models (Sonnet/Haiku) for Worker-Agent task execution | Curating knowledge requires higher reasoning quality than executing well-defined atomic tasks. Budget allocation should reflect this. |
| **Memory observability** | Every memory write operation is logged with agent identity, level, and timestamp | "What you don't measure, you can't improve." Memory drift, bloat, and staleness are detectable only with proper instrumentation. |
| **Silent Memory Flush before compaction** | Agents must flush important findings to Level 2 (daily protocol) before their context window is compacted/summarized | Prevents knowledge loss when the LLM's detailed conversation history is truncated for token management. |
| **Domain locking enforcement** | Only the designated domain expert writes to their EXPERT.md; cross-domain writes are blocked | Prevents "knowledge drift" where a less specialized agent overwrites expert-curated patterns. |
| **Confidence-based pruning** *[target]* | Periodically archive entries with confidence < 0.3 or entries older than 90 days without reconfirmation | Prevents unbounded memory growth and keeps the active knowledge base relevant. |
| **Knowledge graph selective loading** | At delegation time, load only the knowledge graph branches relevant to the agent's task domain | Reduces token waste by up to 67% compared to flat full-context injection. Keeps agent reasoning focused. |

### 8.19 Gamification *[target]*

Evidence-gated quality progression system. XP tied to hard signals, not text production.

**XP Formula:**

```
XP = Base x Quality x Difficulty x Novelty x Integrity

Where:
  Base = 10
  Quality = clamp(0..2, 0.5 + 0.5 * q)
    q from: CI passing, review approved, reconcile pass, no reopens
  Difficulty = from task complexity, time budget, risk level
  Novelty = high if skill area untrained; decays with repetition (anti-grind)
  Integrity = 0 if evidence missing or suspicious patterns detected
```

**Anti-Gaming Mechanisms:**

| Mechanism | Purpose |
|-----------|---------|
| Evidence-gating | No XP without evidence object (CI/review/benchmark) |
| Diminishing returns | Same skill category gives less XP short-term |
| Random audits | 1-in-10 runs sampled; fail = XP clawback |
| Reopen penalty | Bug reopened / regression = partial XP reversal |
| Rate limits | Per agent/skill/day caps prevent micro-task farming |
| Cross-agent review | Leads rate workers, workers rate leads (bidirectional) |

**Skill Dimensions** (mapped to existing skills):

| Dimension | Evidence Source | Skill File |
|-----------|---------------|------------|
| API Design | Code review quality, endpoint consistency | `skills/api-design.md` |
| Testing Strategy | Test coverage, regression rate | `skills/testing-strategy.md` |
| Security Hygiene | Vulnerability findings, audit completeness | `skills/security-audit.md` |
| Task Decomposition | Wave efficiency, dependency correctness | `skills/task-decomposition.md` |
| Code Review | Review thoroughness, false positive rate | `skills/code-review.md` |

---

## 9. Architecture Decisions

### ADR-001: File-based Coordination over Database/Message Queue

**Status:** Accepted  
**Context:** Need a coordination mechanism between independently running AI agent processes that can survive crashes and be human-inspectable.  
**Decision:** Use Markdown/YAML files in `workspace/` as the canonical state store. All agents read/write these files. A file watcher provides the event layer.  
**Alternatives Considered:**
- *SQLite database* -- Better query capability and atomic transactions, but less human-readable and harder to manually inspect/edit during debugging. Would require a shared DB connection across processes.
- *Redis / Message queue* -- Low-latency pub/sub, but adds infrastructure dependency and loses git-trackability. Overkill for single-machine, single-user operation.
- *Shared memory / IPC* -- Fast but volatile; no crash recovery without additional persistence layer.

**Consequences:**
- (+) Human-readable -- developers can inspect and manually edit state
- (+) Git-trackable -- full history of all state changes
- (+) Crash-recoverable -- files persist independently of processes
- (+) No database dependency for core orchestration
- (-) No atomic transactions -- concurrent writes can corrupt (mitigated by wave-based scheduling and single-writer-per-file convention)
- (-) No query capability -- must parse files to extract structured data
- (-) Scaling limited to local file system performance

### ADR-002: Tiered Process Isolation (tmux + Containers)

**Status:** Accepted  
**Context:** Need to run multiple AI agents in parallel with output capture, debuggability, and appropriate security boundaries. Different hierarchy levels have different trust and isolation requirements.  
**Decision:** Tiered isolation model: Maestro and Team-Leads run in tmux panes (trusted, debuggable via `tmux attach`). Worker-Agents run in rootless containers (Docker/Podman) with cgroup resource limits (CPU, memory, disk). Dev-mode fallback: all agents in tmux.  
**Alternatives Considered:**
- *tmux-only (previous approach)* -- Lightweight and debuggable, but no resource limits and no security boundary for Worker-Agents executing untrusted code.
- *Containers-only* -- Strong isolation for all agents, but heavy startup overhead (~2-5s per container), harder to debug interactively for trusted lead agents.
- *Bare child processes (`child_process.spawn`)* -- Simplest, cross-platform, but no output persistence, no attach capability, no resource limits.
- *Kubernetes pods* -- Enterprise-grade isolation and scheduling, but massive overhead for local single-developer use.

**Consequences:**
- (+) Trusted agents (Maestro, Leads) remain lightweight and debuggable via tmux
- (+) Untrusted execution (Workers) gets proper resource limits and filesystem isolation
- (+) Crash-resilient -- both tmux sessions and containers survive Maestro crashes
- (+) Dev-mode fallback keeps local development simple
- (-) Linux/macOS only -- no native Windows support for either runtime
- (-) Two runtimes to manage increases operational complexity
- (-) Container startup latency for Worker-Agents (~2-5s vs near-instant tmux)

### ADR-003: Unlimited-Depth Recursive Tree over Fixed-Level or Flat Dispatch

**Status:** Accepted  
**Context:** Complex software tasks require decomposition, specialization, and quality review. Flat dispatch (all agents equal) loses accountability. A fixed-depth hierarchy (e.g., exactly 3 levels) artificially limits the system's ability to handle tasks of varying complexity.  
**Decision:** Unlimited-depth recursive tree structure with a level-based role model: Level 1 = Maestro, Level 2..n-1 = Team-Leads, Level n = Worker-Agents. Any agent that has the `delegate` tool in its frontmatter can spawn sub-agents, who can in turn spawn their own sub-agents -- forming an arbitrarily deep hierarchy. The default configuration ships with 3 levels (Maestro -> Team-Leads -> Worker-Agents), but this is a configuration choice, not an architectural constraint. Teams and sub-teams can be added to `multi-team-config.yaml` without code changes, and agents at any level can be granted the `delegate` tool to enable further decomposition.  
**Alternatives Considered:**
- *Flat dispatch* -- All agents parallel, no hierarchy. Simpler, but loses accountability, quality review, and task decomposition capability. No natural quality gates.
- *Fixed 3-level hierarchy* -- Maestro -> Leads -> Workers hardcoded. Simpler to reason about, but artificially constrains complex tasks that benefit from deeper decomposition (e.g., a Backend Dev needing to spawn DB + API specialists).
- *DAG-based workflow (LangGraph-style)* -- Directed acyclic graph of nodes. Powerful for known workflows, but rigid -- requires predefined graph topology. Our recursive tree adapts dynamically to task complexity.

**Consequences:**
- (+) Adapts to task complexity -- shallow trees for simple work, deep trees for complex projects
- (+) Clear accountability at each level via parent-child delegation
- (+) Natural quality gates (parent reviews child output) at every tree level
- (+) No artificial ceiling on team size or specialization depth
- (+) New levels/teams added purely through configuration (agent .md files + config YAML)
- (-) More coordination overhead as depth increases
- (-) Deeper context chains risk information loss across many levels
- (-) Must guard against runaway recursion (mitigated by configurable max-depth limit and agent spawn budget per session)

### ADR-004: Append-only Mental Models over Full Rewrite

**Status:** Accepted (extended by ADR-008: 4-Level Memory System)  
**Context:** Agent learning must persist across sessions without risk of knowledge loss or corruption.  
**Decision:** Memory Level 3 updates (MEMORY.md / EXPERT.md) are append-only Markdown with confidence scores. The `update_memory` tool only adds entries, never removes or overwrites. This principle applies specifically to Memory Level 3 (Long-term Memory & Expertise) within the broader 4-level memory architecture (ADR-008). The **ExpertiseStore** component (Section 5.2.2) enforces append-only semantics and domain locking.  
**Alternatives Considered:**
- *Full rewrite per session* -- Agent rewrites entire mental model after each task. Risks knowledge loss if the LLM hallucinates or forgets prior learnings. No audit trail.
- *Vector database (embeddings)* -- Semantic search over learned patterns. Better retrieval for large knowledge bases, but loses human readability, harder to audit, and adds infrastructure dependency.
- *Versioned snapshots (git-style)* -- Full model stored per version with diffs. Better history, but more complex to implement. Planned as evolution path for compaction.
- *ACE Generator-Reflector-Curator loop* -- Autonomous curation of knowledge with a dedicated reflector agent that distills and prunes. Powerful but adds complexity. Planned for training pipeline *[target]*.

**Consequences:**
- (+) No knowledge loss -- every learning preserved
- (+) Auditable history -- can trace when patterns were learned
- (+) Safe concurrent updates -- append operations don't conflict
- (+) Human-readable and manually editable
- (-) Unbounded growth -- files grow indefinitely
- (-) Potential memory drift -- outdated patterns persist alongside newer corrections
- (-) No compaction -- stale entries accumulate, increasing prompt token cost
- Mitigation (planned): Periodic compaction with confidence-based pruning; curator agent for knowledge hygiene *[target]*

### ADR-005: Plugin-Slot Architecture for Extensibility *[target]*

**Status:** Proposed  
**Context:** System must support different runtimes (tmux/container/cloud), SCM providers, issue trackers, and notification channels without core coupling.  
**Decision:** Define stable plugin interfaces for 6 slots: RuntimePlugin, WorkspacePlugin, SCMPlugin, TrackerPlugin, NotifierPlugin, TerminalPlugin. Core depends on interfaces, not implementations.  
**Alternatives Considered:**
- *Monolithic integrations* -- Hardcode each integration into the core. Simpler initially, but every new integration requires core changes and increases coupling.
- *Microservices per integration* -- Each integration runs as a separate service with its own API. Maximum isolation, but massive overhead for local single-user deployment.
- *Event-driven hooks (webhooks/callbacks)* -- Loose coupling via events. Good for notifications, but insufficient for synchronous operations like "create workspace" or "capture terminal output."

**Consequences:**
- (+) Decoupled -- swap implementations without touching core
- (+) Testable -- mock plugins for unit tests
- (+) Extensible -- community can add integrations
- (+) Production-validated pattern -- proven in real-world agent orchestration systems
- (-) Interface design must be stable -- breaking changes cascade
- (-) Plugin discovery and loading adds complexity
- (-) Potential abstraction leakage -- not all runtimes have identical capabilities (e.g., container runtime supports resource limits, tmux does not)

### ADR-006: Wave-based Scheduling over Free-form Parallel Execution

**Status:** Accepted  
**Context:** Multiple agents working in parallel can create race conditions on shared artifacts (workspace files, source code). Need a scheduling strategy that balances parallelism with correctness.  
**Decision:** Tasks are sorted into dependency waves. All tasks in wave N must complete before wave N+1 starts. Within a wave, tasks execute in parallel. Reconciliation runs between waves.  
**Alternatives Considered:**
- *Free-form parallel execution with locking* -- Maximum parallelism, but requires complex file-level locking (symbol-level locking via AST parsing as in Wit protocol). Higher throughput but harder to debug and reason about.
- *Strict sequential execution* -- One task at a time. Simplest, no race conditions, but extremely slow for independent tasks.
- *DAG-based fine-grained scheduling* -- Individual task dependencies tracked; a task starts as soon as all its predecessors complete. Maximum efficiency, but complex dependency tracking and harder to insert reconciliation checkpoints.

**Consequences:**
- (+) Clear execution phases -- easy to reason about and debug
- (+) Natural reconciliation points between waves
- (+) No race conditions within a wave (tasks operate on independent artifacts)
- (+) Simple implementation -- topological sort into waves
- (-) Suboptimal parallelism -- fast tasks in wave N must wait for slow tasks before wave N+1 starts
- (-) Coarse-grained -- some wave N+1 tasks could safely start before all wave N tasks complete

### ADR-007: LLM Provider Abstraction with Failover Chain

**Status:** Accepted  
**Context:** Agents depend on external LLM APIs that may experience outages, rate limits, or degraded performance. A single-provider dependency creates a single point of failure for the entire orchestration system.  
**Decision:** Each agent definition specifies a primary model and the system supports a configurable failover chain. If the primary provider returns errors (5xx, rate limit, timeout), the system attempts the next provider in the chain before failing the task.  
**Alternatives Considered:**
- *Single provider, retry-only* -- Retry the same provider with exponential backoff. Simpler, but useless during extended outages.
- *Load balancing across providers* -- Round-robin or latency-based routing. More complex, and different models have different capabilities/pricing -- not interchangeable for all tasks.

**Consequences:**
- (+) Increased availability -- system continues operating during single-provider outages
- (+) Rate limit resilience -- can spread load across providers
- (-) Different models produce different quality outputs -- failover may degrade task quality
- (-) API key management for multiple providers increases configuration complexity
- (-) Cost unpredictability when failing over to more expensive providers

### ADR-008: 4-Level Memory System over Flat Mental Models

**Status:** Accepted  
**Context:** The original single-level mental model (append-only YAML per agent) does not address temporal memory needs: ephemeral session state, mid-term episodic knowledge, long-term expertise, and cross-agent organizational knowledge. Agents lose valuable context during session compaction, and there is no mechanism for cross-agent knowledge synthesis.  
**Decision:** Implement a 4-level memory system with hierarchy-based write permissions: (1) Active Session Context (JSONL DAG, ephemeral), (2) Daily Protocols (episodic Markdown, mid-term), (3) Long-term Memory & Expertise (per-agent MEMORY.md/EXPERT.md, domain-locked), (4) Structured Knowledge Graph (Maestro-curated, project-wide). Memory flows upward through Silent Memory Flush (L1->L2), lead curation (L2->L3), and Maestro distillation (L3->L4). At delegation time, relevant knowledge graph branches are selectively loaded downward (L4->L1).  
**Alternatives Considered:**
- *Single-level append-only YAML (previous approach)* -- Simple, but no temporal differentiation. Session knowledge lost on compaction. No cross-agent synthesis. Unbounded growth without compaction strategy.
- *Vector database (RAG)* -- Semantic retrieval from a shared embedding store. Good recall for large knowledge bases, but loses human readability, requires infrastructure dependency, harder to audit, and creates an opaque "black box" of agent knowledge.
- *Centralized database (SQLite/PostgreSQL)* -- Strong query capability and atomic transactions, but loses git-trackability, human readability, and the ability to review memory evolution via `git diff`.

**Consequences:**
- (+) Temporal differentiation -- each memory level matches a distinct cognitive need
- (+) Hierarchy-governed write access -- prevents knowledge drift from less capable models
- (+) Git-integrated -- all persistent memory (Levels 2-4) is auditable via `git log` and `git diff`
- (+) Selective loading -- knowledge graph branches reduce token waste by up to 67%
- (+) Silent Memory Flush prevents knowledge loss during context compaction
- (-) More complex than single-level approach -- 4 levels to manage and coordinate
- (-) Requires discipline in memory promotion workflow (Worker -> Lead -> Maestro)
- (-) Knowledge graph curation adds overhead to the Maestro's responsibilities

---

## 10. Quality Requirements

### 10.1 Quality Tree

```mermaid
graph TB
    Q["Quality"]
    Q --> Reliability
    Q --> Extensibility
    Q --> Observability
    Q --> Resilience
    Q --> Security

    Reliability --> R1["No orphaned processes<br/>after session ends"]
    Reliability --> R2["All reconcile errors<br/>detected and fix-tasked"]
    Reliability --> R3["Wave ordering<br/>respected"]

    Extensibility --> E1["New agent type<br/>in < 30 min"]
    Extensibility --> E2["New skill in < 10 min"]
    Extensibility --> E3["New runtime plugin<br/>without core changes"]

    Observability --> O1["Full delegation chain<br/>traceable in logs"]
    Observability --> O2["Real-time task status<br/>in Web UI"]

    Resilience --> RS1["Session survives<br/>orchestrator crash"]
    Resilience --> RS2["State recoverable<br/>from workspace files"]

    Security --> S1["Agents restricted to<br/>declared domain paths"]
    Security --> S2["Secrets never in<br/>workspace files"]

    style Q fill:#438DD5,color:#fff
```

### 10.2 Quality Scenarios

Quality scenarios follow the arc42-recommended stimulus-response structure: Source -> Stimulus -> Environment -> Response -> Metric.

| ID | Quality Goal | Source | Stimulus | Environment | Expected Response | Metric |
|----|-------------|--------|----------|-------------|-------------------|--------|
| QS-01 | Reliability | Maestro | All tasks in a wave complete; session ends | Normal operation | All tmux panes cleaned up; no orphaned processes remain | 0 orphan panes |
| QS-02 | Reliability | Engineering wave | TypeScript compilation errors in produced code | Post-wave reconciliation | `reconcile("tsc --noEmit")` detects errors, auto-creates fix-tasks, loops until pass | 0 undetected errors; max 3 fix-task iterations |
| QS-03 | Extensibility | Developer | Wants to add a new worker agent type | Development time | Create agent `.md` file with frontmatter, add to `multi-team-config.yaml`, available on next session | < 30 minutes, 0 code changes |
| QS-04 | Extensibility | Developer | Wants to add a new domain skill | Development time | Create skill `.md` in `skills/`, reference in agent frontmatter, injected at next delegation | < 10 minutes, 0 code changes |
| QS-05 | Observability | Developer | Needs to trace a delegation from goal to final output | Post-session review | `log.md` + `status.md` + task files contain complete delegation chain with timestamps and agent identifiers | 100% traceability for all delegations |
| QS-06 | Observability | Agent | Task status changes (e.g., pending -> in_progress -> complete) | Runtime, Web UI open | Web UI reflects status change via WebSocket broadcast | < 3 second latency from file write to UI update |
| QS-07 | Resilience | System | Maestro process crashes mid-wave | Agents running in tmux panes | tmux sessions survive independently; `run.sh --resume` reconstructs state from workspace files; no agent work lost | 0 lost completed work |
| QS-08 | Resilience | LLM Provider | Primary API returns 5xx errors or rate limit | Agent mid-task | System retries with backoff, then fails over to secondary provider; task continues without restart | < 30 second recovery time |
| QS-09 | Security | Agent | Attempts to write to a file path outside its declared `domain.upsert` patterns | Runtime | Pi runtime blocks the write; error logged; agent receives clear error message | 0 unauthorized writes |
| QS-10 | Security | External | Prompt injection attempt via workspace file content | Agent reading task files | System prompt sections (policy/rules) separated from user content; sanitized before injection into shell commands | 0 successful injections |
| QS-11 | Performance | Maestro | Wave of 4 parallel agents needs to start | Normal operation, < max_panes | All agents spawned in tmux panes with assembled prompts | < 5 seconds total spawn time |
| QS-12 | Performance | System | 10+ agents accumulated mental model entries over 50 sessions | Long-running project | Agent prompt assembly completes without exceeding context window; mental model pruned/archived if necessary | < 8000 tokens total prompt size |

---

## 11. Risks and Technical Debt

> **Convention:** Risks are things that *might* happen and are managed with contingency plans. Technical debt is shortcuts *already taken* that carry ongoing maintenance cost ("interest rate"). Both are tracked here for visibility, not blame.

### 11.1 Risks

| # | Risk | Probability | Impact | Trigger / Early Warning | Mitigation | Owner |
|---|------|-------------|--------|------------------------|------------|-------|
| R1 | **tmux dependency** -- system requires tmux, limiting to Linux/macOS; no Windows support | Medium | High | User reports / adoption metrics | Abstract RuntimePlugin interface (ADR-005); container-based and bare-process alternatives *[target]* | Architecture |
| R2 | **Resource exhaustion** -- runaway Worker-Agent exceeds container limits or Maestro/Lead in tmux consumes excessive resources | Low | High | System monitor shows agent consuming >80% RAM or CPU | Worker-Agents in containers with cgroup limits (CPU, memory, disk); spawn budget for concurrent agents; per-agent `time_budget` as backstop; Maestro/Leads monitored via stall detection | Architecture |
| R3 | **LLM provider outage** -- API outages or rate limits halt all active agents simultaneously | Medium | High | HTTP 5xx responses or rate limit headers from provider | Model failover chain per ADR-007; exponential backoff; local model support as ultimate fallback *[target]* | Operations |
| R4 | **Concurrent file writes** -- multiple agents in the same wave write to overlapping files | Medium | Medium | Corrupted `status.md` or `log.md` detected during monitoring | Single-writer convention (see 8.11); file locking *[target]*; wave-based scheduling as primary prevention | Architecture |
| R5 | **Context window overflow** -- mental models + skills + shared context exceed LLM context limit | Medium | Medium | Agent responses degrade in quality; truncation errors from LLM API | Token budget monitoring (see 8.10); mental model pruning *[target]*; skill progressive disclosure | Architecture |
| R6 | **Runaway recursion** -- agent spawns unbounded sub-agents, exhausting panes and API budget | Low | High | Pane count approaching max; delegation depth exceeding expected levels | Configurable `max_delegation_depth` and spawn budget (see 8.8); depth guard in `delegate` tool | Architecture |
| R7 | **Secret exposure** -- OAuth tokens passed via environment variables could leak into log files, task files, or assembled prompts | Low | High | Secrets appearing in `workspace/log.md` or `sessions/prompt-*.md` | Secret-aware logging (redaction); OS keychain integration *[target]*; never write env vars to workspace files | Security |
| R8 | **Prompt injection via workspace files** -- malicious content in task files or workspace artifacts could manipulate agent behavior | Low | High | Agent produces unexpected behavior after reading a task file with unusual content | System prompt / user content separation; input sanitization before shell execution (control char stripping); domain path restrictions | Security |
| R9 | **Mental model drift** -- outdated or incorrect patterns persist indefinitely in append-only models, degrading agent quality over time | Medium | Medium | Agent repeatedly follows outdated patterns despite newer corrections | Confidence-based pruning *[target]*; curator agent for knowledge hygiene *[target]*; manual review capability | Quality |

### 11.2 Technical Debt

| # | Debt | Impact | Interest Rate | Remediation | Priority |
|---|------|--------|---------------|-------------|----------|
| D1 | ~~**YAML parsing via python3**~~ | -- | -- | Resolved in v3.0: native `yaml` npm package used; Zod schema validation for all config/frontmatter | Done |
| D2 | **No automated tests** -- no test suite for orchestrator extension or web server | High | High -- every change risks regressions; no confidence in refactoring | Add test framework (Vitest); unit tests for config loading, prompt assembly, task parsing; integration tests for delegation flow | High |
| D3 | **No web server authentication** -- terminal access and API endpoints open to anyone on localhost | Medium | Medium -- acceptable for single-user local use, but blocks any multi-user or remote access scenario | Bind to 127.0.0.1 only (current interim); session-bound tokens and rate limiting *[target]* | Medium |
| D4 | **Hardcoded timeouts and limits** -- stall timeout, wave timeout, max panes are hardcoded constants rather than configurable | Low | Low -- but forces code changes for tuning | Extract to `multi-team-config.yaml` system section | Low |
| D5 | **No structured error types** -- errors returned as strings rather than typed error objects with codes | Medium | Medium -- makes error handling in parent agents brittle and hard to match on | Define error type hierarchy: `SpawnError`, `TimeoutError`, `ReconcileError`, `ProviderError` with structured fields | Medium |

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI-powered process with a specific role, system prompt, mental model, skills, and tool permissions. Defined by a Markdown file with YAML frontmatter (`agents/*.md`). |
| **Agent Definition** | The static configuration of an agent: name, model, expertise path, skills, tool permissions, domain restrictions, and system prompt body. Stored in `agents/*.md`. |
| **Agent Instance** | A running agent process, bound to a specific tmux pane, task, and session. Tracked in the `ActiveWorkers` map. |
| **ACP** | Anthropic Claude Platform -- OAuth-based API access for Claude models. |
| **Backpressure** | Resource management strategy that queues new delegation requests when the system reaches capacity (max panes, rate limits). See Section 8.9. |
| **Context Window** | The finite token budget available to an LLM for a single inference call. Managed via token budget allocation (Section 8.10). |
| **Correlation ID** *[target]* | A unique identifier propagated through all log entries, task files, and API observations in a delegation subtree. Enables end-to-end tracing. |
| **Delegation** | The act of spawning a new agent process (in tmux pane or container) with an assembled system prompt (agent body + L3 expertise + L4 knowledge graph branches + skills + shared context + task). Any agent with the `delegate` tool (Maestro, Team-Leads) can delegate, enabling recursive sub-trees of arbitrary depth. |
| **Delegation Depth** | The number of levels between the current agent and the Maestro (Level 1). Bounded by `max_delegation_depth` to prevent runaway recursion. |
| **Failover Chain** | Ordered list of LLM providers to attempt when the primary provider fails. See ADR-007. |
| **Handoff Report** | A structured task output with four mandatory sections: Changes Made, Patterns Followed, Unresolved Concerns, Suggested Follow-up Tasks. |
| **Knowledge Graph (Level 4)** | The project-wide, cross-agent organizational memory maintained as a hierarchical Markdown mind-map in `memory/knowledge-graph/`. Curated primarily by the Maestro. Selective branch loading reduces token consumption at delegation time. |
| **Team-Lead (Level 2..n-1)** | An intermediate agent managing a specialized team of sub-agents (e.g., Planning Lead, Engineering Lead). Has the `delegate` tool to spawn sub-agents. Creates domain strategies, manages domain-specific expertise files (`EXPERT.md`), and enforces quality gates. Team-Leads can exist at any depth between the Maestro and the leaf Worker-Agents. |
| **Maestro (Level 1)** | The root agent in the hierarchy tree. Decomposes goals into tasks, delegates to Team-Leads, monitors progress, runs reconciliation, and manages the central project memory (knowledge graph, Level 4). The Maestro holds the strategic overview and is the sole curator of the cross-agent knowledge graph. |
| **Memory Level** | One of four tiers in the Agent Memory System: Level 1 (Active Session Context / Ephemeral), Level 2 (Daily Protocols / Episodic), Level 3 (Long-term Memory & Expertise / Semantic), Level 4 (Knowledge Graph / Persistent). See Section 8.4. |
| **Mental Model (Level 3)** | Per-agent Markdown files (`memory/agents/{name}/MEMORY.md` and `EXPERT.md`) storing learned patterns, preferences, strengths, mistakes to avoid, and domain expertise. Part of Memory Level 3. Append-only updates with confidence scores. Domain-locked write access (enforced by MemoryAccessControl) prevents knowledge drift. |
| **Meta-Agent** *[target]* | A planned agent that optimizes team composition based on historical mission data, agent skill levels, and quality metrics. |
| **NotebookLM** | Google's AI notebook tool that answers questions exclusively from user-uploaded documents (source-grounded, no internet search). |
| **Orchestrator** | Legacy term for the Maestro role, used in earlier versions. Superseded by **Maestro** in v3.0. |
| **Pi** | A coding agent framework (e.g., `@mariozechner/pi-coding-agent`) that can serve as runtime for agent processes. Provides tool-use, extensions, and session management. One of several possible agent runtime implementations. |
| **Plan-Approval Gate** | A two-phase quality protocol: (1) worker writes a proposed approach and sets status to `plan_ready`, (2) lead reviews and sets `plan_approved` before worker implements. |
| **Plugin Slot** *[target]* | A swappable interface for system capabilities. Six slots: Runtime, Workspace, SCM, Tracker, Notifier, Terminal. Each has multiple possible implementations. |
| **Progressive Disclosure** | Skill injection pattern where only skill descriptions sit in the permanent context; full instructions are loaded on-demand when matched by task type. Prevents prompt pollution. |
| **Reconciliation** | Running a validation command (e.g., `tsc --noEmit`, `npm test`) after an engineering wave. On failure, automatically creates a fix-task. Loops until pass (max 3 iterations). |
| **Shared Context** | Files injected into every agent's system prompt: `shared-context/README.md` plus workspace state files (goal.md, plan.md, status.md). |
| **Skill** | A reusable Markdown document (`skills/*.md`) injected into an agent's system prompt at delegation time. Defines domain knowledge and best practices. |
| **Spawn Budget** | Maximum number of concurrent tmux panes per session. New delegations are queued when the budget is exhausted. |
| **Stall Detection** | Monitoring mechanism that detects agents producing no output within a configurable timeout. Triggers escalation: nudge -> kill -> reassign. |
| **Training Pipeline** *[target]* | A reflection-based improvement process: Outcome Evidence -> Reflection Summary -> Mental Model Update -> Skill Delta -> XP Event. No weight fine-tuning. |
| **Wave** | A group of tasks with no mutual dependencies that can execute in parallel. Wave N+1 starts only after wave N completes. Reconciliation runs between waves. |
| **Worker-Agent (Level n)** | A leaf agent that executes atomic tasks in isolated containers (production) or tmux panes (dev mode) and delivers structured handoff reports. Worker-Agents do not have the `delegate` tool by default. Granting `delegate: true` promotes a Worker-Agent to a Team-Lead. |
| **Silent Memory Flush** | A mandatory lifecycle transition (`pre_compaction` hook) where an agent writes important findings from Level 1 to Level 2 before context compaction. Managed by the DailyProtocolFlusher component (Section 5.2.2). Uses NO_REPLY sentinel to remain invisible to users. See runtime sequence in Section 6.8. |
| **Domain Locking** | Memory access control mechanism enforced by MemoryAccessControl (Section 5.2.2). Only the designated domain expert (Team-Lead) has write access to their `EXPERT.md`. All denials are logged. |
| **Conventional Memory Commit** | Git commit with a `mem:` prefix for memory operations (e.g., `mem: update backend patterns`). Created by GitCheckpointEngine (Section 5.2.2). Enables filtering memory evolution via `git log --grep="^mem:"`. |
| **Session DAG** | A JSONL-based Directed Acyclic Graph (Level 1 memory) that records every message and tool call with `id`/`parentId` for branching. Enables rewind to stable checkpoints without losing history. Managed by SessionDAGManager (Section 5.2.2). See runtime sequence in Section 6.7. |
| **Memory Subsystem** | A first-class container (Section 5.1, 5.2.2) responsible for operating all four memory levels. Contains: SessionDAGManager, DailyProtocolFlusher, ExpertiseStore, KnowledgeGraphLoader, GitCheckpointEngine, MemoryAccessControl. |
| **Model Tier** | Classification of LLM usage by agent role: `curator` (Maestro, high-reasoning for memory curation), `lead` (Team-Leads, domain strategy), `worker` (Worker-Agents, cost-effective for atomic tasks). Configured in agent frontmatter and resolved to concrete model IDs via `model_tier_policy` in project config. See Section 8.15. |
| **RuntimeManager** | Component that selects and manages the execution runtime for agents: tmux panes for Maestro/Team-Leads (debuggable), containers for Worker-Agents (isolated, resource-limited). Dev-mode fallback: all agents in tmux. |
| **ExpertiseStore** | Memory Subsystem component (Section 5.2.2) that manages Level 3 memory: reads/writes MEMORY.md and EXPERT.md per agent, enforces domain locking, and runs confidence-based compaction. |
| **KnowledgeGraphLoader** | Memory Subsystem component (Section 5.2.2) that manages Level 4 memory: reads the knowledge graph index, selects relevant branches by task domain, and returns a token-budgeted context slice for prompt assembly. |
| **Write-Ahead Queue** *[target]* | Fault tolerance pattern where task queue is persisted to disk before execution. Enables checkpoint/restart after crashes. |
| **XP Event** *[target]* | A gamification event recording evidence-backed quality score for a completed task. XP = Base x Quality x Difficulty x Novelty x Integrity. |

---

## 13. Future Improvements and Evolution Roadmap

This section consolidates all planned improvements, potential enhancements identified during architecture review, and longer-term evolution paths. Items are prioritized by their impact on system reliability, quality, and developer experience.

### 13.1 High Priority -- Reliability and Correctness

| # | Improvement | Rationale | Effort |
|---|------------|-----------|--------|
| F1 | **Automated test suite** | No tests exist (D2). Every change risks regressions. Core test coverage for config loading, prompt assembly, task parsing, delegation flow, and reconciliation logic. | High |
| F2 | **Structured error types** | Errors are currently strings (D5). Typed error hierarchy (`SpawnError`, `TimeoutError`, `ReconcileError`, `ProviderError`) enables reliable error handling in parent agents and UI. | Medium |
| F3 | **Write-ahead task queue** | Persist delegation queue to disk before execution. On crash, replay from last completed task instead of restarting entire session. Critical for long-running multi-wave sessions. | Medium |
| F4 | **File-level advisory locking** | Eliminate remaining concurrent write edge cases (R4) via `flock()` or lightweight lock manager for `status.md` and `log.md`. | Low |
| F5 | **LLM failover chain implementation** | Currently documented (ADR-007) but not fully implemented. Provider-level retry with exponential backoff, then failover to secondary/tertiary model. | Medium |

### 13.2 Medium Priority -- Scalability and Robustness

| # | Improvement | Rationale | Effort |
|---|------------|-----------|--------|
| F6 | ~~**Container-based RuntimePlugin**~~ | Resolved in v3.0: Worker-Agents run in rootless containers (Docker/Podman) with cgroup limits. Maestro/Team-Leads use tmux. See ADR-002 and Section 8.5. | Done |
| F7 | **Memory Level 3 compaction and pruning** | Confidence-based archival of low-confidence or outdated entries in MEMORY.md/EXPERT.md. Curator agent (ACE Reflector-Curator pattern) for autonomous knowledge hygiene across all 4 memory levels. Resolves R9. | Medium |
| F8 | **Correlation IDs across delegation chains** | Propagate unique trace ID through all logs, task files, and observations. Enables filtering all activity for a specific delegation subtree. | Medium |
| F9 | **Configurable timeouts and limits** | Extract hardcoded constants (D4) to `multi-team-config.yaml` system section: stall_timeout, wave_timeout, max_panes, max_delegation_depth, time_budget defaults. | Low |
| F10 | **Git-worktree workspace isolation** | Each agent gets its own git worktree for filesystem isolation. Prevents agents from conflicting on source code. Merge at wave completion. | High |

### 13.3 Medium Priority -- Training and Quality

| # | Improvement | Rationale | Effort |
|---|------------|-----------|--------|
| F11 | **Training pipeline (Reflection-based)** | Post-task reflection: Outcome Evidence -> Reflection Summary -> Mental Model Update -> Skill Delta. ACE Generator-Reflector-Curator loop for autonomous improvement. | High |
| F12 | **Evidence-gated XP/Gamification** | SQLite-backed skill progression with anti-gaming (diminishing returns, random audits, reopen penalties). XP tied to hard signals only (CI pass, review approval, reconcile success). | High |
| F13 | **Meta-Agent for team composition** | Policy agent that learns from historical mission outcomes to optimize team formation. Bandit-style exploration of team configurations. | High |
| F14 | **Cross-agent review protocol** | Bidirectional review: leads rate workers, workers rate leads. Reduces single-direction manipulation. Feeds into XP integrity factor. | Medium |

### 13.4 Lower Priority -- Extensibility and DX

| # | Improvement | Rationale | Effort |
|---|------------|-----------|--------|
| F15 | **Plugin registry and discovery** | Formalize the 6 plugin slots (ADR-005) with TypeScript interfaces, registration mechanism, and configuration-driven loading. | High |
| F16 | **SCM integration (GitHub)** | Branch creation, PR management, CI status polling as SCMPlugin. Enables automated code review and merge-readiness quality signals. | Medium |
| F17 | **Issue tracker integration (Linear/Jira)** | TrackerPlugin for bi-directional issue sync. Link tasks to external tickets. | Medium |
| F18 | **Notification integration (Slack)** | NotifierPlugin for real-time alerts: wave completion, reconciliation failures, agent stalls. | Low |
| F19 | **SSE event endpoint** | Replace WebSocket polling-based file watching with Server-Sent Events for simpler unidirectional streaming. Start with polling-SSE, evolve to push-based. | Medium |
| F20 | **Session-bound web auth** | Replace "bind to localhost" with proper session tokens and rate limiting (D3). Required if system ever supports remote access. | Medium |
| F21 | ~~**Migrate YAML parsing to npm**~~ | Resolved in v3.0: native `yaml` npm package + Zod schema validation. No python3 dependency. | Done |

### 13.5 Exploration / Research

| # | Area | Description |
|---|------|-------------|
| F22 | **Agent-to-Agent protocol (A2A)** | Evaluate Google's A2A protocol for agent capability discovery via `agent.json` cards. Could enable dynamic team formation without manual configuration. |
| F23 | **Model Context Protocol (MCP)** | Evaluate Anthropic's MCP for standardized tool discovery and integration. Could replace custom tool definitions in agent frontmatter. |
| F24 | **Symbol-level file locking** | Tree-sitter AST-based locking (Wit protocol pattern) for shared source files. Locks specific functions rather than entire files, enabling finer-grained parallel edits. |
| F25 | **Local model support** | Run smaller models locally (Ollama, llama.cpp) as fallback when cloud providers are unavailable. Trades quality for availability. |
| F26 | **Delta-based context optimization** | For follow-up tasks in the same session, send only the changed repository state rather than full context (Longshot pattern). Reduces token consumption. |
| F27 | **Time-travel debugging** | Leverages the Memory Level 1 JSONL DAG (session context with branching). After a failure, the agent can branch back to a stable checkpoint in the DAG rather than restarting the entire task. |

---

> **Legend:**  
> - *[target]* -- Planned feature, not yet implemented  
> - Dashed borders/lines in diagrams indicate planned components  
> - All file paths are relative to the repository root unless noted otherwise  
> - Sections 8.7-8.16 in Cross-cutting Concepts were added during the architecture review to address reliability, fault tolerance, resource management, and operational concerns identified as gaps in the initial documentation
