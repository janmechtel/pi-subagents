import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentDefaults } from "../agents/definitions.ts";
import { getAgentConfigDir } from "../agents/definitions.ts";
import type { ParentClosePolicy, SubagentParamsInput } from "../types.ts";

export function getSubagentAgentRequirementError(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
) {
	if (!params.agent) {
		return {
			content: [
				{
					type: "text" as const,
					text: "Error: agent is required for subagent launches.",
				},
			],
			details: { error: "agent_required" },
		};
	}
	if (!agentDefs) {
		const globalDir = join(getAgentConfigDir(), "agents");
		return {
			content: [
				{
					type: "text" as const,
					text: `Error: agent "${params.agent}" was not found in .pi/agents/ or ${globalDir}.`,
				},
			],
			details: { error: "agent_not_found", agent: params.agent },
		};
	}
	return null;
}

export function getUnknownForkContextWindowError(
	agent: string | undefined,
	modelRef: string | undefined,
) {
	return {
		content: [
			{
				type: "text" as const,
				text: modelRef
					? `Error: cannot fork subagent${agent ? ` "${agent}"` : ""} because model "${modelRef}" has no known context window in Pi's model registry. Pin the agent to a registered model with context metadata, or use session-mode: lineage-only/standalone if it must not inherit parent context.`
					: `Error: cannot fork subagent${agent ? ` "${agent}"` : ""} because no child model is pinned, so the runtime cannot know the child context window. Add model: <provider>/<model-id> to the agent frontmatter, or use session-mode: lineage-only/standalone if it must not inherit parent context.`,
			},
		],
		details: { error: "unknown_fork_context_window", agent, model: modelRef },
	};
}

export function getSubagentAgentOverrideError(
	_params: Partial<SubagentParamsInput>,
	_agentDefs: AgentDefaults | null,
) {
	// Named-agent frontmatter is authoritative. Call-time fields such as model,
	// tools, cwd, and background are ignored by enforceAgentFrontmatter instead
	// of rejected; this keeps the runtime consistent with the public tool schema.
	return null;
}

export function resolveSubagentBlocking(
	_params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
): boolean {
	if (agentDefs?.async != null) return agentDefs.async === false;
	if (agentDefs?.blocking != null) return agentDefs.blocking === true;
	return false;
}

function resolveSubagentAsync(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
): boolean {
	return !resolveSubagentBlocking(params, agentDefs);
}

export function resolveSubagentNoContextFiles(
	agentDefs: AgentDefaults | null,
): boolean {
	return agentDefs?.noContextFiles ?? false;
}

export function resolveSubagentNoSession(
	agentDefs: AgentDefaults | null,
): boolean {
	return agentDefs?.noSession ?? false;
}

export function resolveSubagentParentClosePolicy(
	agentDefs: AgentDefaults | null,
): ParentClosePolicy {
	return agentDefs?.parentClosePolicy ?? "terminate";
}

function isSchemeLikePath(value: string): boolean {
	return (
		/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value)
	);
}

function resolveSubagentExtensionSource(
	source: string,
	baseDir: string,
): string {
	const trimmed = source.trim();
	if (!trimmed) return trimmed;
	if (isSchemeLikePath(trimmed)) return trimmed;
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	if (trimmed.startsWith("~\\")) return join(homedir(), trimmed.slice(2));
	return resolve(baseDir, trimmed);
}

export function resolveSubagentExtensions(
	agentDefs: AgentDefaults | null,
): string[] | undefined {
	if (!agentDefs?.extensions) return undefined;
	const raw = agentDefs.extensions.trim().toLowerCase();
	if (raw === "none" || raw === "false" || raw === "off" || raw === "[]")
		return [];
	const baseDir = agentDefs.cwdBase ?? process.cwd();
	const resolved = agentDefs.extensions
		.split(",")
		.map((source) => source.trim())
		.filter(Boolean)
		.map((source) => resolveSubagentExtensionSource(source, baseDir));
	return resolved.length > 0 ? [...new Set(resolved)] : [];
}

export function enforceAgentFrontmatter(
	params: SubagentParamsInput,
	agentDefs: AgentDefaults | null,
): SubagentParamsInput {
	return {
		name: params.name,
		task: params.task,
		title: params.title,
		agent: params.agent,
		async: resolveSubagentAsync(params, agentDefs),
		blocking: resolveSubagentBlocking(params, agentDefs),
	};
}
