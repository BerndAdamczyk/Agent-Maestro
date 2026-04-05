/**
 * Agent Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/agents, GET /api/agents/:slug
 */

import { Router } from "express";
import type { AgentResolver } from "../../../src/config.js";

export function agentRoutes(agentResolver: AgentResolver): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const agents = agentResolver.getAllAgents().map(a => ({
      name: a.frontmatter.name,
      model: a.frontmatter.model,
      modelTier: a.frontmatter.model_tier,
      skills: a.frontmatter.skills,
      tools: a.frontmatter.tools,
      role: agentResolver.getAgentRole(a.frontmatter.name),
      level: agentResolver.getAgentHierarchyLevel(a.frontmatter.name),
      team: agentResolver.getTeamForAgent(a.frontmatter.name),
      color: agentResolver.getAgentColor(a.frontmatter.name),
    }));
    res.json(agents);
  });

  router.get("/:name", (req, res) => {
    const agent = agentResolver.findAgentByName(req.params.name as string);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json({
      name: agent.frontmatter.name,
      model: agent.frontmatter.model,
      modelTier: agent.frontmatter.model_tier,
      skills: agent.frontmatter.skills,
      tools: agent.frontmatter.tools,
      memory: agent.frontmatter.memory,
      domain: agent.frontmatter.domain,
      body: agent.body,
      role: agentResolver.getAgentRole(agent.frontmatter.name),
      level: agentResolver.getAgentHierarchyLevel(agent.frontmatter.name),
      team: agentResolver.getTeamForAgent(agent.frontmatter.name),
      color: agentResolver.getAgentColor(agent.frontmatter.name),
    });
  });

  return router;
}
