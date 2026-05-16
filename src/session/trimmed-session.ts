/**
 * Fork session trimming.
 *
 * A forked child inherits a suffix of the parent session. The suffix must fit the
 * child model's context window, not the parent's. Pi stores cumulative input
 * checkpoints on assistant messages as usage.input + usage.cacheRead; trimming is
 * based only on those checkpoints. No tokenizer guesses are used here.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TrimmedForkSessionOptions {
	/** The child model's total context window in tokens. */
	childContextWindow: number;
	/** Tokens to reserve for the child model's output. Defaults to 10_000. */
	reserveTokens?: number;
	/** Tool call id for the subagent launch that is creating this fork. */
	launchToolCallId?: string;
	/** Session title to write into the forked child session header. */
	sessionName?: string;
}

const DEFAULT_RESERVE_TOKENS = 10_000;

interface ParsedEntry {
	line: string;
	parsed: Record<string, unknown>;
}

interface TokenSegment {
	entries: ParsedEntry[];
	totalTokens: number;
	/** Cumulative at the first successful assistant in this segment, so callers
	 * can normalize totalTokens to segment-local values. Zero when the segment
	 * starts at the beginning of the session (no prior resets). */
	segmentBase: number;
}

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function getCumulativeInputTokens(usage: Record<string, unknown>): number {
	const input = typeof usage.input === "number" ? usage.input : 0;
	const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
	return input + cacheRead;
}

function readSessionEntries(sessionFile: string): ParsedEntry[] {
	const content = readFileSync(sessionFile, "utf-8");
	const entries: ParsedEntry[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			entries.push({ line: trimmed, parsed: JSON.parse(trimmed) });
		} catch {
			// Ignore malformed historical lines; Pi will report them if it loads the session directly.
		}
	}
	return entries;
}

function buildSessionHeader(
	headerEntry: ParsedEntry,
	parentSessionFile: string,
	sessionName?: string,
): string {
	return JSON.stringify({
		...headerEntry.parsed,
		timestamp: new Date().toISOString(),
		parentSession: parentSessionFile,
		...(sessionName ? { name: sessionName } : {}),
	});
}

function getMessage(entry: ParsedEntry): Record<string, unknown> | undefined {
	if (entry.parsed.type !== "message") return undefined;
	return entry.parsed.message as Record<string, unknown> | undefined;
}

function getAssistantUsage(
	entry: ParsedEntry,
): Record<string, unknown> | undefined {
	const msg = getMessage(entry);
	if (msg?.role !== "assistant") return undefined;
	const stopReason = msg.stopReason as string | undefined;
	if (stopReason === "aborted" || stopReason === "error") return undefined;
	return msg.usage as Record<string, unknown> | undefined;
}

function hasSuccessfulAssistant(entry: ParsedEntry): boolean {
	const msg = getMessage(entry);
	if (msg?.role !== "assistant") return false;
	const stopReason = msg.stopReason as string | undefined;
	return stopReason !== "aborted" && stopReason !== "error";
}

/**
 * Tool call content blocks can use different type strings depending on the
 * upstream API provider: "toolCall" (OpenAI), "toolUse" (Anthropic/Google),
 * or potentially other variants. Check both.
 */
function isToolCallBlock(block: unknown): block is Record<string, unknown> {
	if (!block || typeof block !== "object") return false;
	const type = (block as Record<string, unknown>).type;
	return type === "toolCall" || type === "toolUse";
}

function hasToolCallId(entry: ParsedEntry, toolCallId: string): boolean {
	const msg = getMessage(entry);
	if (msg?.role !== "assistant") return false;
	const content = msg.content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => {
		if (!isToolCallBlock(block)) return false;
		return block.id === toolCallId;
	});
}

function getEntriesBeforeLaunch(
	entries: ParsedEntry[],
	launchToolCallId?: string,
): ParsedEntry[] {
	if (!launchToolCallId) return entries;
	const launchIndex = entries.findIndex((entry) =>
		hasToolCallId(entry, launchToolCallId),
	);
	return launchIndex < 0 ? entries : entries.slice(0, launchIndex);
}

function getLatestTokenSegment(
	entries: ParsedEntry[],
	parentSessionFile: string,
): TokenSegment | undefined {
	let sawAssistant = false;
	let segmentStart = 0;
	let totalTokens = 0;
	// Cumulative at the first successful assistant in the current segment.
	// Used to normalize totalTokens so it reflects only the token contribution
	// of entries within the segment, not pre-segment content.
	// Only meaningful when the segment starts after a reset boundary
	// (segmentStart > 0); for the initial segment segmentBase stays 0.
	let segmentBase = 0;
	let foundSegmentStart = false;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (!hasSuccessfulAssistant(entry)) continue;
		sawAssistant = true;

		const usage = getAssistantUsage(entry);
		if (!usage) {
			throw new Error(
				`Cannot safely fork ${parentSessionFile}: assistant message is missing usage metadata. ` +
					"Pi cannot compute a deterministic fork trim without per-turn token checkpoints.",
			);
		}

		const tokens = getCumulativeInputTokens(usage);
		if (tokens <= 0) {
			// Forked sessions intentionally zero inherited assistant usage after trimming.
			// Treat zero usage as a reset boundary so a nested fork can use later real
			// child checkpoints without mixing them with inherited parent entries.
			segmentStart = i + 1;
			totalTokens = 0;
			foundSegmentStart = false;
			continue;
		}

		// NOTE: decreasing cumulative checkpoints (tokens < previousTokens) from
		// context-pruning extensions (pi-context-prune, API-ext pruning) do NOT
		// create segment boundaries. The entries are still in the session file and
		// should be inherited by the child. Only zeroed checkpoint entries
		// (nested-fork artifacts) are real segment boundaries.

		// Record the base cumulative of the first assistant in the segment.
		// This is the session-wide cumulative at the segment boundary, used to
		// normalize subsequent totals to segment-local values.
		if (!foundSegmentStart) {
			segmentBase = tokens;
			foundSegmentStart = true;
		}

		totalTokens = tokens;
	}

	if (!sawAssistant || totalTokens <= 0) return undefined;

	// Only normalize when a reset (zero-usage or token-drop) created a segment
	// boundary. For the initial unpruned segment, totalTokens stays session-wide
	// so the budget comparison doesn't undercount pre-first-assistant entries.
	// segmentBase must also be 0 in that case so findTrimStart doesn't
	// normalize with a stale first-assistant checkpoint.
	const hasReset = segmentStart > 0;
	const segmentTokens = hasReset ? totalTokens - segmentBase : totalTokens;
	return { entries: entries.slice(segmentStart), totalTokens: segmentTokens, segmentBase: hasReset ? segmentBase : 0 };
}

/**
 * Check if a toolCallId exists in any assistant entry at or after `fromIndex`.
 */
function hasToolCallIdInRange(
	entries: ParsedEntry[],
	fromIndex: number,
	toolCallId: string,
): boolean {
	for (let i = fromIndex; i < entries.length; i++) {
		if (hasToolCallId(entries[i], toolCallId)) return true;
	}
	return false;
}

/**
 * Check if an entry is a toolResult with an orphaned tool call reference
 * (the tool call was excluded by the trim).
 */
function isOrphanedToolResult(
	entry: ParsedEntry,
	entries: ParsedEntry[],
	trimStart: number,
): boolean {
	if (entry.parsed.type !== "message") return false;
	const msg = entry.parsed.message as Record<string, unknown> | undefined;
	if (msg?.role !== "toolResult") return false;
	const toolCallId = msg.toolCallId as string | undefined;
	if (!toolCallId) return false;
	// The tool call is orphaned if it doesn't appear in any entry at or after trimStart.
	return !hasToolCallIdInRange(entries, trimStart, toolCallId);
}

function findTrimStart(
	entries: ParsedEntry[],
	totalTokens: number,
	budget: number,
	/**
	 * Session-wide cumulative at the first assistant of this entry slice.
	 * Subtracted from each assistant's cumulative to produce segment-local
	 * token counts for the overflow comparison. Zero for segments with no
	 * prior reset (the first assistant is at the beginning of the session).
	 */
	segmentBase = 0,
): number {
	const overflow = totalTokens - budget;
	let previousAssistantTokens = 0;
	let previousAssistantIndex = -1;

	for (let i = 0; i < entries.length; i++) {
		const usage = getAssistantUsage(entries[i]);
		if (!usage) continue;

		// Normalize to segment-local: subtract the base cumulative so that
		// the first assistant in the segment contributes 0 and subsequent
		// assistants represent only the token growth within the segment.
		const tokens = getCumulativeInputTokens(usage) - segmentBase;

		if (previousAssistantTokens >= overflow) {
			const start = previousAssistantIndex + 1;
			// Skip orphaned tool results whose tool calls were excluded by the trim.
			// The openai-responses API rejects conversations with tool results that
			// reference non-existent tool call IDs.
			let adjusted = start;
			while (
				adjusted < entries.length &&
				isOrphanedToolResult(entries[adjusted], entries, start)
			) {
				adjusted++;
			}
			return adjusted;
		}

		previousAssistantTokens = tokens;
		previousAssistantIndex = i;
	}

	return 0;
}

/**
 * Neutralize tool call blocks in forked assistant messages to text placeholders.
 *
 * Forked children inherit the parent session's assistant messages verbatim,
 * including raw tool call IDs that belong to the parent's provider context.
 * These session-local identifiers have no place in the child session —
 * pi's internal tool call state management should never see foreign IDs from
 * a parent session that used a different provider, different model, or even
 * the same provider under a different runtime instance.
 *
 * Replacing tool call blocks with simple text placeholders preserves the
 * semantic information (which tool was called, and the conversation flow)
 * without leaking provider-specific routing metadata across the fork boundary.
 */
function neutralizeToolCallBlocks(content: unknown[]): unknown[] {
	if (!Array.isArray(content)) return content;
	const result: unknown[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			result.push(block);
			continue;
		}
		const b = block as Record<string, unknown>;
		if (b.type === "toolCall" || b.type === "toolUse") {
			const name = typeof b.name === "string" ? b.name : "unknown";
			result.push({
				type: "text",
				text: `[tool call: ${name}]`,
			});
		} else {
			result.push(block);
		}
	}
	return result;
}

function serializeEntry(entry: ParsedEntry): string {
	const parsedClone = structuredClone(entry.parsed);

	if (parsedClone.type !== "message") {
		(parsedClone as any).message = {
			role: "custom",
			content: [],
			usage: zeroUsage(),
		};
		return JSON.stringify(parsedClone);
	}

	const msg = parsedClone.message as Record<string, unknown> | undefined;
	if (!msg) return JSON.stringify(parsedClone);

	// Parent usage is no longer valid after trimming. Keep a zero stub because the
	// compiled renderer expects message.usage.input on copied entries.
	msg.usage = zeroUsage();
	// Neutralize inherited tool call blocks from the parent session.
	// Tool call IDs are session-local routing tokens that belong to the
	// parent's provider context. They must not leak into the child session,
	// regardless of which provider either side uses.
	if (msg.role === "assistant" && Array.isArray(msg.content)) {
		msg.content = neutralizeToolCallBlocks(msg.content);
	}
	// Neutralize inherited tool results: strip the toolCallId and convert to
	// a user message. The result text is preserved — the model sees the tool
	// output in context — but the foreign tool call metadata is removed so
	// pi never tries to resolve parent session IDs against child session state.
	if (msg.role === "toolResult" && Array.isArray(msg.content)) {
		msg.role = "user";
		delete msg.toolCallId;
	}
	parsedClone.message = msg;
	return JSON.stringify(parsedClone);
}

function writeChildSession(
	entries: ParsedEntry[],
	headerEntry: ParsedEntry,
	childSessionFile: string,
	parentSessionFile: string,
	sessionName?: string,
): void {
	mkdirSync(dirname(childSessionFile), { recursive: true });
	const lines = [buildSessionHeader(headerEntry, parentSessionFile, sessionName)];
	for (const entry of entries) {
		if (entry.parsed.type !== "session") {
			// Children never receive ambient awareness (skipped in session_start for
			// parentSession sessions). Drop the roster to avoid wasting context window.
			if (
				entry.parsed.type === "custom_message" &&
				(entry.parsed as Record<string, unknown>).customType === "subagent_roster"
			) continue;
			lines.push(serializeEntry(entry));
		}
	}
	writeFileSync(childSessionFile, `${lines.join("\n")}\n`, "utf-8");
}

export function writeTrimmedForkSession(
	parentSessionFile: string,
	childSessionFile: string,
	options: TrimmedForkSessionOptions,
): void {
	const entries = readSessionEntries(parentSessionFile);
	const headerEntry = entries.find((entry) => entry.parsed.type === "session");
	if (!headerEntry)
		throw new Error(`No session header found in ${parentSessionFile}`);

	const reserveTokens = options.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
	const budget = options.childContextWindow - reserveTokens;
	if (budget <= 0) {
		writeChildSession([], headerEntry, childSessionFile, parentSessionFile, options.sessionName);
		return;
	}

	const entriesBeforeLaunch = getEntriesBeforeLaunch(
		entries,
		options.launchToolCallId,
	);
	const segment = getLatestTokenSegment(entriesBeforeLaunch, parentSessionFile);
	if (!segment) {
		writeChildSession([], headerEntry, childSessionFile, parentSessionFile, options.sessionName);
		return;
	}

	const entriesToKeep =
		segment.totalTokens <= budget
			? segment.entries
			: segment.entries.slice(
					findTrimStart(segment.entries, segment.totalTokens, budget, segment.segmentBase),
				);
	writeChildSession(
		entriesToKeep,
		headerEntry,
		childSessionFile,
		parentSessionFile,
		options.sessionName,
	);
}
