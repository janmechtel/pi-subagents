import type { AgentDefaults } from "../agents/definitions.ts";
import {
	getEffectiveAgentDefinitions,
	resolveForkOutputReserveTokens,
} from "../agents/definitions.ts";
import {
	CHILD_CONTEXT_BOUNDARY_SYSTEM_PROMPT,
	buildChildContextBoundary,
	type ChildContextBoundaryOptions,
} from "../launch/context-boundary.ts";
import {
	getPiInvocation,
	getPiShellParts,
	getSubagentChildProcessEnv,
	parseCommandWords,
} from "../launch/child-command.ts";
import {
	getExtensionLaunchArgs,
	getPreparedSessionLaunchArgs,
	type PreparedSubagentLaunch,
} from "../launch/prep.ts";
import {
	getSubagentAgentOverrideError,
	getSubagentAgentRequirementError,
	resolveSubagentBlocking,
	resolveSubagentExtensions,
	resolveSubagentNoContextFiles,
	resolveSubagentNoSession,
} from "../launch/policy.ts";
import {
	getAgentListEntries,
	getAgentListSignature,
	renderAgentListReminder,
	type AgentListEntry,
} from "../agents/agent-list.ts";
import {
	buildResumePiArgs,
	buildShellChangeDirectoryPrefix,
	getResumeCwd,
	resolveResumeLaunchMetadata,
	type ResumeMode,
} from "../launch/resume.ts";
import {
	resolveSubagentRuntimePaths,
} from "../launch/runtime-paths.ts";
import type {
	RunningSubagent,
	SessionEntryLike,
	SubagentParamsInput,
} from "../types.ts";
import {
	getNoSessionSeedMode,
} from "../launch/seed-child-session.ts";
import {
	buildPiPromptArgs,
	readSubagentLaunchMetadata,
	resolveEffectiveSessionMode,
	resolveTaskSessionMode,
	seedSubagentSessionFile,
	type PersistedSubagentLaunchMetadata,
	type SubagentSessionMode,
	writeSubagentLaunchMetadataEntryWhenReady,
} from "../session/session-files.ts";
import {
	writeSystemPromptArtifact,
} from "../launch/prompt-artifacts.ts";
import {
	addToolModeDeniedNames,
	getSubagentToolAllowlist,
	getSubagentToolLaunchArgs,
	getSubagentToolsConfigError,
	resolveDenyTools,
} from "../tools/policy.ts";
import {
	buildSubagentSessionTitle,
	getSubagentDisplayTitle,
	getTerminalAssistantSummary,
	shouldReapStableTerminalSummary,
	type SubagentTitleParams,
} from "../agents/titles.ts";

export function resolveDenyToolsForTest(agentDefs: AgentDefaults | null) {
	return resolveDenyTools(agentDefs);
}

export function resolveForkOutputReserveTokensForTest(
	agentDefs: AgentDefaults | null,
) {
	return resolveForkOutputReserveTokens(agentDefs);
}

export function getEffectiveAgentDefinitionsForTest(baseCwd = process.cwd()) {
	return getEffectiveAgentDefinitions(baseCwd);
}

export function getAgentListEntriesForTest(baseCwd = process.cwd()) {
	return getAgentListEntries(baseCwd, (agentDefs) =>
		resolveTaskSessionMode(agentDefs, resolveSubagentNoSession, getNoSessionSeedMode),
	);
}

export function renderAgentListReminderForTest(
	entries: AgentListEntry[],
) {
	return renderAgentListReminder(entries);
}

export function getAgentListSignatureForTest(
	entries: AgentListEntry[],
) {
	return getAgentListSignature(entries);
}

export function buildChildContextBoundaryForTest(
	options: ChildContextBoundaryOptions,
) {
	return buildChildContextBoundary(options);
}

export function buildChildContextBoundarySystemPromptForTest() {
	return CHILD_CONTEXT_BOUNDARY_SYSTEM_PROMPT;
}

export function buildSubagentSessionTitleForTest(params: SubagentTitleParams) {
	return buildSubagentSessionTitle(params);
}

export function getSubagentDisplayTitleForTest(
	params: Pick<SubagentParamsInput, "title" | "task">,
) {
	return getSubagentDisplayTitle(params);
}

export function getTerminalAssistantSummaryForTest(entries: SessionEntryLike[]) {
	return getTerminalAssistantSummary(entries);
}

export function getTerminalAssistantSummaryAfterLaunchForTest(
	entries: SessionEntryLike[],
	launchEntryCount: number,
) {
	return getTerminalAssistantSummary(entries.slice(launchEntryCount));
}

export function shouldReapStableTerminalSummaryForTest(
	running: Pick<RunningSubagent, "autoExit">,
) {
	return shouldReapStableTerminalSummary(running);
}

export function getPiInvocationForTest(args: string[]) {
	return getPiInvocation(args);
}

export function getPiShellPartsForTest(args: string[]) {
	return getPiShellParts(args);
}

export function getSubagentChildProcessEnvForTest(
	invocation: { command: string; args: string[] },
	envVars: Record<string, string>,
) {
	return getSubagentChildProcessEnv(invocation, envVars);
}

export function seedSubagentSessionFileForTest(
	mode: Exclude<SubagentSessionMode, "standalone">,
	parentSessionFile: string,
	childSessionFile: string,
	cwd = process.cwd(),
	forkTrimOptions?: {
		childContextWindow: number;
		reserveTokens?: number;
		launchToolCallId?: string;
	},
) {
	seedSubagentSessionFile(mode, parentSessionFile, childSessionFile, cwd, forkTrimOptions);
}

export function resolveTaskSessionModeForTest(agentDefs: AgentDefaults | null) {
	return resolveTaskSessionMode(
		agentDefs,
		resolveSubagentNoSession,
		getNoSessionSeedMode,
	);
}

export async function writeSubagentLaunchMetadataEntryForTest(
	path: string,
	metadata: PersistedSubagentLaunchMetadata,
) {
	await writeSubagentLaunchMetadataEntryWhenReady(path, metadata, 0);
}

export function readSubagentLaunchMetadataForTest(path: string) {
	return readSubagentLaunchMetadata(path);
}

export function resolveEffectiveSessionModeForTest(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
) {
	return resolveEffectiveSessionMode(params, agentDefs);
}

export function buildPiPromptArgsForTest(
	skills: string[],
	taskArg: string,
	directTask: boolean,
) {
	return buildPiPromptArgs(skills, taskArg, directTask);
}

export function writeSystemPromptArtifactForTest(
	name: string,
	systemPrompt: string,
	ctx: { sessionManager: { getSessionId(): string }; cwd: string },
) {
	return writeSystemPromptArtifact(name, systemPrompt, ctx);
}

export function resolveSubagentRuntimePathsForTest(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
	parentCwd: string,
	parentSessionDir: string,
) {
	return resolveSubagentRuntimePaths(params, agentDefs, parentCwd, parentSessionDir);
}

export function getSubagentAgentRequirementErrorForTest(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
) {
	return getSubagentAgentRequirementError(params, agentDefs);
}

export function getSubagentToolsConfigErrorForTest(tools?: string, agent?: string) {
	return getSubagentToolsConfigError(tools, agent);
}

export function getSubagentAgentOverrideErrorForTest(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
) {
	return getSubagentAgentOverrideError(params, agentDefs);
}

export function resolveSubagentBlockingForTest(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
) {
	return resolveSubagentBlocking(params, agentDefs);
}

export function resolveSubagentNoContextFilesForTest(
	agentDefs: AgentDefaults | null,
) {
	return resolveSubagentNoContextFiles(agentDefs);
}

export function resolveSubagentNoSessionForTest(agentDefs: AgentDefaults | null) {
	return resolveSubagentNoSession(agentDefs);
}

export function resolveSubagentExtensionsForTest(agentDefs: AgentDefaults | null) {
	return resolveSubagentExtensions(agentDefs);
}

export function getSubagentToolAllowlistForTest(
	tools?: string,
	deniedTools: Iterable<string> = [],
) {
	return getSubagentToolAllowlist(tools, new Set(deniedTools));
}

export function getSubagentToolLaunchArgsForTest(
	tools?: string,
	deniedTools: Iterable<string> = [],
) {
	return getSubagentToolLaunchArgs(tools, new Set(deniedTools));
}

export function getSubagentToolDeniedNamesForTest(
	tools?: string,
	deniedTools: Iterable<string> = [],
) {
	return [...addToolModeDeniedNames(new Set(deniedTools), tools)];
}

export function getExtensionLaunchArgsForTest(
	extensionSpecs: string[] | undefined,
	mandatoryExtensionPath: string,
) {
	return getExtensionLaunchArgs(extensionSpecs, mandatoryExtensionPath);
}

export function getFlagsLaunchArgs(flags: string | undefined) {
	if (!flags?.trim()) return [];
	return parseCommandWords(flags);
}

export function getPreparedSessionLaunchArgsForTest(
	agentDefs: AgentDefaults | null,
) {
	return getPreparedSessionLaunchArgs({
		agentDefs,
		subagentSessionFile: "child.jsonl",
	} as PreparedSubagentLaunch);
}

export function getResumeCwdForTest(
	metadata: PersistedSubagentLaunchMetadata | undefined,
) {
	return getResumeCwd(metadata);
}

export function buildShellChangeDirectoryPrefixForTest(cwd: string | undefined) {
	return buildShellChangeDirectoryPrefix(cwd);
}

export function resolveResumeLaunchMetadataForTest(
	sessionFile: string,
	explicitMode?: ResumeMode,
) {
	return resolveResumeLaunchMetadata(sessionFile, explicitMode);
}

export function buildResumePiArgsForTest(
	sessionFile: string,
	mode: ResumeMode = "background",
) {
	return buildResumePiArgs(sessionFile, mode);
}

export function getNoSessionSeedModeForTest(sessionMode: SubagentSessionMode) {
	return getNoSessionSeedMode(sessionMode);
}
