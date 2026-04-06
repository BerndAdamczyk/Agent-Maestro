/**
 * Knowledge Graph Loader - Level 4 Memory.
 * Reference: arc42 Section 5.2.2 (KnowledgeGraphLoader), 8.2 (Prompt Assembly), 8.4 Level 4
 *
 * Reads memory/knowledge-graph/index.md, selects relevant branches by task domain,
 * and returns a token-budgeted context slice.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface GraphIndex {
  sections: Array<{
    title: string;
    domain: string;
    entries: Array<{
      name: string;
      file: string;
      description: string;
    }>;
  }>;
}

export class KnowledgeGraphLoader {
  private graphDir: string;
  private tokenBudget: number;

  constructor(memoryDir: string, tokenBudget: number = 2000) {
    this.graphDir = join(memoryDir, "knowledge-graph");
    this.tokenBudget = tokenBudget;
    mkdirSync(this.graphDir, { recursive: true });
  }

  ensureIndex(): void {
    const indexPath = join(this.graphDir, "index.md");
    if (!existsSync(indexPath)) {
      const template = [
        "# Knowledge Graph: Agent Maestro Project",
        "",
        "## Architecture",
        "",
        "## Patterns",
        "",
        "## Decisions",
        "",
      ].join("\n");
      writeFileSync(indexPath, template, "utf-8");
    }
  }

  readIndex(): string {
    const indexPath = join(this.graphDir, "index.md");
    if (!existsSync(indexPath)) return "";
    return readFileSync(indexPath, "utf-8");
  }

  /**
   * Load relevant knowledge graph branches for a task.
   * Selection: match domain tags against graph sections.
   * Returns a token-budgeted string.
   */
  loadBranches(domainTags: string[]): string {
    const indexContent = this.readIndex();
    if (!indexContent) return "";

    // Parse index for linked files
    const linkedFiles = this.extractLinks(indexContent);
    if (linkedFiles.length === 0) return indexContent.slice(0, this.estimateChars(this.tokenBudget));

    // Load relevant branch files
    const relevantContent: string[] = [];
    let estimatedTokens = 0;

    // Always include a trimmed index
    const indexSlice = indexContent.slice(0, this.estimateChars(500));
    relevantContent.push(indexSlice);
    estimatedTokens += this.estimateTokens(indexSlice);

    for (const link of linkedFiles) {
      if (estimatedTokens >= this.tokenBudget) break;

      // Check if this file's domain matches any requested tags
      const matchesDomain = domainTags.length === 0 || domainTags.some(tag =>
        link.toLowerCase().includes(tag.toLowerCase())
      );

      if (!matchesDomain) continue;

      const filePath = join(this.graphDir, link);
      if (!existsSync(filePath)) continue;

      const content = readFileSync(filePath, "utf-8");
      const tokens = this.estimateTokens(content);

      if (estimatedTokens + tokens <= this.tokenBudget) {
        relevantContent.push(`\n---\n### ${link}\n${content}`);
        estimatedTokens += tokens;
      } else {
        // Partial inclusion
        const remaining = this.tokenBudget - estimatedTokens;
        const slice = content.slice(0, this.estimateChars(remaining));
        relevantContent.push(`\n---\n### ${link} (truncated)\n${slice}`);
        break;
      }
    }

    return relevantContent.join("\n");
  }

  private extractLinks(content: string): string[] {
    const linkRe = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
    const links: string[] = [];
    let match;
    while ((match = linkRe.exec(content)) !== null) {
      links.push(match[2]!);
    }
    return links;
  }

  // Rough token estimation (~4 chars per token for English)
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private estimateChars(tokens: number): number {
    return tokens * 4;
  }
}
