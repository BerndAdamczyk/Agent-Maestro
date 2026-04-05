/**
 * Tmux Service - Web server wrapper around tmux operations.
 * Reference: arc42 Section 5.2.3 (TmuxService)
 */

import { execSync } from "node:child_process";

export interface PaneOutput {
  paneId: string;
  content: string;
}

export class TmuxService {
  private sessionName: string;

  constructor(sessionName: string) {
    this.sessionName = sessionName;
  }

  sessionExists(): boolean {
    try {
      execSync(`tmux has-session -t ${this.sessionName}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  listPanes(): Array<{ paneId: string; windowName: string; active: boolean }> {
    try {
      const output = execSync(
        `tmux list-panes -s -t ${this.sessionName} -F "#{pane_id}|#{window_name}|#{pane_active}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();

      return output.split("\n").filter(Boolean).map(line => {
        const [paneId, windowName, active] = line.split("|");
        return { paneId: paneId!, windowName: windowName!, active: active === "1" };
      });
    } catch {
      return [];
    }
  }

  capturePane(paneId: string, lines: number = 200): string {
    try {
      return execSync(`tmux capture-pane -t ${paneId} -p -S -${lines}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return "";
    }
  }

  sendKeys(paneId: string, keys: string): void {
    const sanitized = keys.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
    execSync(`tmux send-keys -t ${paneId} ${JSON.stringify(sanitized)} Enter`, {
      stdio: "pipe",
    });
  }
}
