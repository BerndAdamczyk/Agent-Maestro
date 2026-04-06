/**
 * Memory Routes.
 * GET /api/memory/tree?path=<relative>
 * GET /api/memory/file?path=<relative>
 */

import { Router } from "express";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";

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

    const resolved = join(memoryDir, normalizedRelative);
    const normalizedRoot = normalize(memoryDir + sep);
    const normalizedResolved = normalize(resolved);
    if (normalizedResolved !== normalize(memoryDir) && !normalizedResolved.startsWith(normalizedRoot)) {
      return null;
    }
    if (pathContainsSymlink(memoryDir, normalizedResolved)) {
      return null;
    }

    return resolved;
  };

  router.get("/tree", (req, res) => {
    const relativePath = String(req.query.path || ".");
    const resolvedPath = resolveInsideMemory(relativePath);
    if (!resolvedPath) {
      res.status(400).json({ error: "Invalid memory path" });
      return;
    }

    if (!existsSync(resolvedPath) || !lstatSync(resolvedPath).isDirectory()) {
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

    if (!existsSync(resolvedPath) || !lstatSync(resolvedPath).isFile()) {
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

function pathContainsSymlink(rootDir: string, targetPath: string): boolean {
  const relativePath = relative(rootDir, targetPath);
  if (!relativePath || relativePath === "") {
    return false;
  }

  let currentPath = rootDir;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    if (!existsSync(currentPath)) {
      return false;
    }
    if (lstatSync(currentPath).isSymbolicLink()) {
      return true;
    }
  }

  return false;
}
