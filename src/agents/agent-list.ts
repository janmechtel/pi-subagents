import type { ResolvedAgentDefinition } from "./definitions.ts";
import { getEffectiveAgentDefinitions } from "./definitions.ts";

export type SubagentSessionMode = "standalone" | "lineage-only" | "fork";

export interface AgentListEntry {
	name: string;
	source: "project" | "global";
	mode?: "interactive" | "background";
	sessionMode: SubagentSessionMode;
	description?: string;
}

export type ResolveSubagentSessionMode = (
	agent: ResolvedAgentDefinition,
) => SubagentSessionMode;

export function isAmbientAwarenessDisabled(): boolean {
	return process.env.PI_SUBAGENT_DISABLE_AMBIENT_AWARENESS === "1";
}

export function getAgentListEntries(
	baseCwd: string,
	resolveSessionMode: ResolveSubagentSessionMode,
): AgentListEntry[] {
	return getEffectiveAgentDefinitions(baseCwd)
		.filter((agent) => agent.description?.trim())
		.map((agent) => ({
			name: agent.name,
			source: agent.source,
			mode: agent.mode,
			sessionMode: resolveSessionMode(agent),
			description: agent.description,
		}));
}

export function getSessionModeMemoryLabel(
	sessionMode: SubagentSessionMode,
): string {
	return sessionMode === "fork" ? "forked context" : "isolated context";
}

export function renderAgentListReminder(
	entries: AgentListEntry[],
): string {
	const lines = entries.map((entry) => {
		const modeTag = entry.mode === "background" ? " (background)" : "";
		return `- ${entry.name}${modeTag} [${getSessionModeMemoryLabel(entry.sessionMode)}] — ${entry.description}`;
	});
	const body = [
		"Available named subagents:",
		...lines,
		"CRITICAL: The agent list above is for routing only. If the user names an agent and it is not found, do not mention other agents from this list, do not suggest alternatives. Just report the agent was not found and stop. Agent definitions are user-owned, not model-chosen.",
		"Memory label rule: isolated context means the subagent starts a fresh chat and cannot see this conversation, so write a self-contained task with objective, relevant facts/files, constraints, and expected output. forked context means the subagent continues from this conversation on a new branch, so give goal, boundary, and expected output without re-explaining everything.",
		"If this list is updated later, the newer version replaces this one. Use subagent explicitly.",
		"When launching more than one child for the same request, call subagent once with children: [...] so the runtime starts every child before waiting.",
	].join("\n");
	return `<system-reminder>\n${body}\n</system-reminder>`;
}

export function getAgentListSignature(
	entries: AgentListEntry[],
): string {
	return JSON.stringify(
		entries.map((entry) => ({
			name: entry.name,
			source: entry.source,
			mode: entry.mode,
			sessionMode: entry.sessionMode,
			description: entry.description,
		})),
	);
}
