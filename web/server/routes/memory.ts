/**
 * Memory Routes.
 * GET /api/memory/tree?path=<relative>
 * GET /api/memory/file?path=<relative>
 */

import { Router } from "express";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { normalize, relative, resolve, sep } from "node:path";

interface MemoryEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export function memoryRoutes(memoryDir: string): Router {
  const router = Router();

  const resolveInsideMemory = (requestedPath: string): string | null => {
    const normalizedRelative = normalize(requestedPath || ".");
    if (normalizedRelative.startsWith("..") || normalizedRelative.includes(`..${sep}`)) {
      return null;
    }

    const lexicalPath = resolve(memoryDir, normalizedRelative);
    const lexicalRelative = relative(resolve(memoryDir), lexicalPath).replace(/\\/g, "/");
    if (lexicalRelative.startsWith("..")) {
      return null;
    }

    if (!existsSync(lexicalPath)) {
      return null;
    }

    let resolvedPath: string;
    let resolvedRoot: string;
    try {
      resolvedPath = realpathSync(lexicalPath);
      resolvedRoot = realpathSync(memoryDir);
    } catch {
      return null;
    }

    const resolvedRelative = relative(resolvedRoot, resolvedPath).replace(/\\/g, "/");
    if (resolvedRelative.startsWith("..")) {
      return null;
    }

    return resolvedPath;
  };

  router.get("/tree", (req, res) => {
    const relativePath = String(req.query.path || ".");
    const resolvedPath = resolveInsideMemory(relativePath);
    if (!resolvedPath) {
      res.status(400).json({ error: "Invalid memory path" });
      return;
    }

    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
      res.status(404).json({ error: "Memory directory not found" });
      return;
    }

    const entries: MemoryEntry[] = readdirSync(resolvedPath, { withFileTypes: true })
      .filter(entry => !entry.isSymbolicLink())
      .map((entry): MemoryEntry => ({
        name: entry.name,
        path: relativePath === "." ? entry.name : `${relativePath}/${entry.name}`,
        type: entry.isDirectory() ? "directory" : "file",
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ path: relativePath, entries });
  });

  router.get("/file", (req, res) => {
    const relativePath = String(req.query.path || "");
    if (!relativePath) {
      res.status(400).json({ error: "Missing memory file path" });
      return;
    }

    const resolvedPath = resolveInsideMemory(relativePath);
    if (!resolvedPath) {
      res.status(400).json({ error: "Invalid memory path" });
      return;
    }

    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      res.status(404).json({ error: "Memory file not found" });
      return;
    }

    res.json({
      path: relativePath,
      content: readFileSync(resolvedPath, "utf-8"),
    });
  });

  return router;
}
