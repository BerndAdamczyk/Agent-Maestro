/**
 * Handoff report validation.
 * Reference: arc42 Sections 6.2, 8.14, 8.16
 */

import type { HandoffReport, HandoffValidation } from "./types.js";
import { formatTimestamp } from "./utils.js";

const SUBSTANTIVE_MIN_LENGTH = 12;
const PLACEHOLDER_ONLY_RE = /^(?:n\/a|na|none|nothing|todo|tbd|unknown|-|\.\.\.)$/i;
const EXPLICIT_NONE_RE = /^(?:none|none noted|no follow-?ups|no unresolved concerns|none at this time|n\/a)\.?$/i;

export function validateHandoffReport(report: HandoffReport | null): HandoffValidation {
  const issues: string[] = [];

  if (!report) {
    return buildValidation(["Missing handoff report."]);
  }

  const changesMade = normalize(report.changesMade);
  const patternsFollowed = normalize(report.patternsFollowed);
  const unresolvedConcerns = normalize(report.unresolvedConcerns);
  const suggestedFollowups = normalize(report.suggestedFollowups);

  validateRequiredNarrative("Changes Made", changesMade, issues);
  validateRequiredNarrative("Patterns Followed", patternsFollowed, issues);
  validateRequiredSection("Unresolved Concerns", unresolvedConcerns, issues, true);
  validateRequiredSection("Suggested Follow-ups", suggestedFollowups, issues, true);

  if (changesMade && patternsFollowed && changesMade === patternsFollowed) {
    issues.push("Changes Made and Patterns Followed must not be identical.");
  }

  if (
    unresolvedConcerns &&
    suggestedFollowups &&
    unresolvedConcerns === suggestedFollowups &&
    !isExplicitNone(unresolvedConcerns)
  ) {
    issues.push("Unresolved Concerns and Suggested Follow-ups must not be identical.");
  }

  return buildValidation(issues);
}

function validateRequiredNarrative(label: string, value: string, issues: string[]): void {
  validateRequiredSection(label, value, issues, false);

  if (!value) return;
  if (PLACEHOLDER_ONLY_RE.test(value)) {
    issues.push(`${label} is still a placeholder.`);
    return;
  }
  if (value.length < SUBSTANTIVE_MIN_LENGTH) {
    issues.push(`${label} is too short to be actionable.`);
  }
}

function validateRequiredSection(
  label: string,
  value: string,
  issues: string[],
  allowExplicitNone: boolean,
): void {
  if (!value) {
    issues.push(`${label} is missing.`);
    return;
  }

  if (!allowExplicitNone && PLACEHOLDER_ONLY_RE.test(value)) {
    issues.push(`${label} is still a placeholder.`);
    return;
  }

  if (allowExplicitNone && isExplicitNone(value)) {
    return;
  }

  if (value.length < SUBSTANTIVE_MIN_LENGTH) {
    issues.push(`${label} is too short to be actionable.`);
  }
}

function buildValidation(issues: string[]): HandoffValidation {
  return {
    status: issues.length === 0 ? "valid" : "invalid",
    validatedAt: formatTimestamp(new Date(), { includeMilliseconds: true }),
    issues,
  };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isExplicitNone(value: string): boolean {
  return EXPLICIT_NONE_RE.test(value);
}
