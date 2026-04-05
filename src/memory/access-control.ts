/**
 * Memory Access Control.
 * Reference: arc42 Section 5.2.2 (MemoryAccessControl)
 *
 * Enforces write permissions by hierarchy level:
 *   Maestro (L1): all levels
 *   Team-Leads (L2..n-1): L1-L3 (own domain)
 *   Workers (Ln): L1-L2 only
 */

import type { AgentFrontmatter } from "../types.js";

export interface MemoryAccessRequest {
  agentName: string;
  agentFrontmatter: AgentFrontmatter;
  targetLevel: number;            // 1-4
  targetDomain: string | null;    // for L3 domain lock checks
  operation: "read" | "write";
}

export interface MemoryAccessResult {
  allowed: boolean;
  reason: string;
}

export class MemoryAccessControl {
  check(request: MemoryAccessRequest): MemoryAccessResult {
    const { agentFrontmatter, targetLevel, targetDomain, operation } = request;

    // Reads are always allowed
    if (operation === "read") {
      return { allowed: true, reason: "Read access is unrestricted" };
    }

    // Check if the agent's write_levels include the target level
    if (!agentFrontmatter.memory.write_levels.includes(targetLevel)) {
      return {
        allowed: false,
        reason: `Agent '${agentFrontmatter.name}' does not have write access to memory level ${targetLevel}. Allowed levels: [${agentFrontmatter.memory.write_levels.join(", ")}]`,
      };
    }

    // Domain lock check for L3 writes
    if (targetLevel === 3 && agentFrontmatter.memory.domain_lock !== null && targetDomain !== null) {
      if (agentFrontmatter.memory.domain_lock !== targetDomain) {
        return {
          allowed: false,
          reason: `Agent '${agentFrontmatter.name}' is domain-locked to '${agentFrontmatter.memory.domain_lock}' and cannot write to domain '${targetDomain}'`,
        };
      }
    }

    return { allowed: true, reason: "Access granted" };
  }
}
