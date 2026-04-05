/**
 * Runtime Manager - tmux-based agent process isolation.
 * Reference: arc42 Section 5.1 (RuntimeManager), 7 (Deployment View), ADR-002
 *
 * Dev mode: all agents in tmux panes.
 * Production mode: Workers in containers (future).
 */

import { execSync } from "node:child_process";

export interface PaneInfo {
  paneId: string;
  windowName: string;
  active: boolean;
  pid: number;
  title: string;
}

export class RuntimeManager {
  private sessionName: string;
  private maxPanes: number;
  private activePanes = new Set<string>();

  constructor(sessionName: string, maxPanes: number = 10) {
    this.sessionName = sessionName;
    this.maxPanes = maxPanes;
  }

  private exec(cmd: string): string {
    try {
      return execSync(cmd, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      }).trim();
    } catch (err: any) {
      throw new Error(`tmux command failed: ${cmd}\n${err.stderr || err.message}`);
    }
  }

  sessionExists(): boolean {
    try {
      this.exec(`tmux has-session -t ${this.sessionName}`);
      return true;
    } catch {
      return false;
    }
  }

  ensureSession(): void {
    if (!this.sessionExists()) {
      this.exec(`tmux new-session -d -s ${this.sessionName} -n maestro`);
    }
  }

  /**
   * Create a new pane for an agent.
   * Returns the pane ID (e.g., "%5").
   */
  createPane(agentName: string): string {
    if (this.activePanes.size >= this.maxPanes) {
      throw new Error(
        `Spawn budget exhausted: ${this.activePanes.size}/${this.maxPanes} panes in use. ` +
        `Queue the delegation until a pane frees up.`
      );
    }

    // Create a new window named after the agent slug
    const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    this.exec(`tmux new-window -t ${this.sessionName} -n ${slug}`);

    // Get the pane ID of the newly created window
    const paneId = this.exec(
      `tmux display-message -t ${this.sessionName}:${slug} -p "#{pane_id}"`
    );

    this.activePanes.add(paneId);
    return paneId;
  }

  /**
   * Send a command to a tmux pane.
   */
  sendKeys(paneId: string, command: string): void {
    // Sanitize: strip control characters to prevent injection
    const sanitized = command.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
    this.exec(`tmux send-keys -t ${paneId} ${JSON.stringify(sanitized)} Enter`);
  }

  /**
   * Capture the current pane output.
   */
  capturePane(paneId: string, lines: number = 200): string {
    try {
      return this.exec(`tmux capture-pane -t ${paneId} -p -S -${lines}`);
    } catch {
      return "";
    }
  }

  /**
   * Check if a pane's process is still alive.
   */
  isAlive(paneId: string): boolean {
    try {
      const result = this.exec(`tmux display-message -t ${paneId} -p "#{pane_pid}"`);
      return result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Destroy a pane (cleanup).
   */
  destroyPane(paneId: string): void {
    try {
      this.exec(`tmux kill-pane -t ${paneId}`);
    } catch {
      // Pane might already be gone
    }
    this.activePanes.delete(paneId);
  }

  /**
   * List all panes in the session.
   */
  listPanes(): PaneInfo[] {
    try {
      const output = this.exec(
        `tmux list-panes -s -t ${this.sessionName} -F "#{pane_id}|#{window_name}|#{pane_active}|#{pane_pid}|#{pane_title}"`
      );

      return output.split("\n").filter(Boolean).map(line => {
        const [paneId, windowName, active, pid, title] = line.split("|");
        return {
          paneId: paneId!,
          windowName: windowName!,
          active: active === "1",
          pid: parseInt(pid!, 10),
          title: title ?? "",
        };
      });
    } catch {
      return [];
    }
  }

  getPaneCount(): number {
    return this.activePanes.size;
  }

  getMaxPanes(): number {
    return this.maxPanes;
  }

  hasCapacity(): boolean {
    return this.activePanes.size < this.maxPanes;
  }

  /**
   * Clean up all agent panes (not the maestro window).
   */
  cleanupAllPanes(): void {
    for (const paneId of this.activePanes) {
      this.destroyPane(paneId);
    }
    this.activePanes.clear();
  }

  releasePaneId(paneId: string): void {
    this.activePanes.delete(paneId);
  }
}
