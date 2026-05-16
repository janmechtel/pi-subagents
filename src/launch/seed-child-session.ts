import { buildChildContextBoundary, isChildContextBoundaryDisabled } from "./context-boundary.ts";
import { resolveForkOutputReserveTokens } from "../agents/definitions.ts";
import type { SubagentLaunchContext, PreparedSubagentLaunch } from "./prep.ts";
import type { SubagentParamsInput } from "../types.ts";
import {
	seedSubagentSessionFile,
	type SubagentSessionMode,
	writeChildContextBoundaryEntry,
	writeSubagentExtensionEntry,
} from "../session/session-files.ts";

export function getNoSessionSeedMode(
	sessionMode: SubagentSessionMode,
): Exclude<SubagentSessionMode, "standalone"> | null {
	if (sessionMode === "standalone") return null;
	return "fork";
}

function getChildSeedMode(
	sessionMode: SubagentSessionMode,
	noSession: boolean,
): Exclude<SubagentSessionMode, "standalone"> | null {
	if (noSession) return getNoSessionSeedMode(sessionMode);
	return sessionMode === "standalone" ? null : sessionMode;
}

function shouldWriteChildContextBoundary(
	seedMode: Exclude<SubagentSessionMode, "standalone"> | null,
): boolean {
	return seedMode === "fork" && !isChildContextBoundaryDisabled();
}

export function seedPreparedSubagentSession(
	prepared: PreparedSubagentLaunch,
	params: Pick<SubagentParamsInput, "name">,
	ctx: Pick<SubagentLaunchContext, "cwd" | "childModelContextWindow" | "launchToolCallId">,
	sessionMode: SubagentSessionMode,
	noSession: boolean,
): {
	seedMode: Exclude<SubagentSessionMode, "standalone"> | null;
	boundarySystemPrompt: boolean;
} {
	const seedMode = getChildSeedMode(sessionMode, noSession);
	const boundarySystemPrompt = shouldWriteChildContextBoundary(seedMode);
	const reserveTokens = resolveForkOutputReserveTokens(prepared.agentDefs);
	if (seedMode) {
		// Lineage-tracked and forked children require a parent session file.
		// If there isn't one, throw a clear error instead of crashing downstream.
		if (!prepared.sessionFile) {
			throw new Error(
				`Cannot launch ${seedMode} subagent: no parent session file. ` +
					`Use session-mode: standalone in the agent frontmatter, ` +
					`or start pi with a persistent session (--session or --session-dir).`,
			);
		}
		const forkTrimOptions =
			seedMode === "fork" && ctx.childModelContextWindow
				? {
						childContextWindow: ctx.childModelContextWindow,
						...(reserveTokens !== undefined ? { reserveTokens } : {}),
						...(ctx.launchToolCallId
							? { launchToolCallId: ctx.launchToolCallId }
							: {}),
					}
				: undefined;
		seedSubagentSessionFile(
			seedMode,
			prepared.sessionFile,
			prepared.subagentSessionFile,
			prepared.runtimePaths.effectiveCwd ?? ctx.cwd,
			{
				...forkTrimOptions,
				...(prepared.sessionTitle ? { sessionName: prepared.sessionTitle } : {}),
			},
		);
		if (boundarySystemPrompt) {
			const boundaryOptions = {
				name: params.name,
				spawningAllowed: prepared.agentDefs?.spawning === true,
			};
			writeChildContextBoundaryEntry(
				prepared.subagentSessionFile,
				boundaryOptions,
				buildChildContextBoundary(boundaryOptions),
			);
		}
	}
	writeSubagentExtensionEntry(
		prepared.subagentSessionFile,
		prepared.effectiveExtensions,
	);
	return { seedMode, boundarySystemPrompt };
}
