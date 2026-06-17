import { spawnSync } from "node:child_process";
import { defaultMuxRuntimeProbe } from "./runtime-probe.ts";

export type HerdrServerStatus = {
	status?: string;
	running: boolean;
	compatible: boolean;
	protocol?: number;
	version?: string;
	capabilities?: Record<string, unknown>;
};

export type HerdrPane = {
	paneId: string;
	tabId?: string;
	workspaceId?: string;
	terminalId?: string;
	cwd?: string;
	foregroundCwd?: string;
	focused?: boolean;
};

export type HerdrTab = {
	tabId: string;
	workspaceId?: string;
	label?: string;
	focused?: boolean;
	paneCount?: number;
};

export type HerdrWorkspace = {
	workspaceId: string;
	activeTabId?: string;
	label?: string;
	focused?: boolean;
	tabCount?: number;
	paneCount?: number;
};

type HerdrProcessResult = ReturnType<typeof spawnSync>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(
	record: Record<string, unknown>,
	field: string,
): string | undefined {
	const value = record[field];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(
	record: Record<string, unknown>,
	field: string,
): number | undefined {
	const value = record[field];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function booleanField(
	record: Record<string, unknown>,
	field: string,
): boolean | undefined {
	const value = record[field];
	return typeof value === "boolean" ? value : undefined;
}

function trimForError(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= 300) return trimmed;
	return `${trimmed.slice(0, 300)}…`;
}

function getOutput(result: HerdrProcessResult): string {
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	const stderr = typeof result.stderr === "string" ? result.stderr : "";
	return stdout.trim() || stderr.trim();
}

function parseHerdrJson(operation: string, output: string): unknown {
	try {
		return JSON.parse(output);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Herdr ${operation} returned malformed JSON: ${message}; output: ${trimForError(output) || "(empty)"}`,
		);
	}
}

function formatHerdrApiError(
	operation: string,
	error: unknown,
	fallback: string,
): Error {
	if (!isRecord(error)) {
		return new Error(`Herdr ${operation} failed: ${fallback}`);
	}
	const code = stringField(error, "code");
	const message = stringField(error, "message");
	if (code && message) {
		return new Error(`Herdr ${operation} failed: ${code}: ${message}`);
	}
	if (message) return new Error(`Herdr ${operation} failed: ${message}`);
	if (code) return new Error(`Herdr ${operation} failed: ${code}`);
	return new Error(`Herdr ${operation} failed: ${fallback}`);
}

function runHerdrJson(operation: string, args: string[]): unknown {
	const result = spawnSync("herdr", args, { encoding: "utf8" });
	if (result.error) {
		throw new Error(
			`Herdr ${operation} failed to start: ${result.error.message}`,
		);
	}

	const output = getOutput(result);
	if (!output) {
		throw new Error(`Herdr ${operation} returned no JSON output`);
	}

	let parsed: unknown;
	try {
		parsed = parseHerdrJson(operation, output);
	} catch (error) {
		if (result.status && result.status !== 0) {
			throw new Error(
				`Herdr ${operation} failed with exit code ${result.status}: ${trimForError(output)}`,
			);
		}
		throw error;
	}

	if (isRecord(parsed) && "error" in parsed) {
		throw formatHerdrApiError(operation, parsed.error, trimForError(output));
	}

	if (result.status && result.status !== 0) {
		throw new Error(
			`Herdr ${operation} failed with exit code ${result.status}: ${trimForError(output)}`,
		);
	}

	return parsed;
}

function runHerdrApi(operation: string, args: string[]): Record<string, unknown> {
	const envelope = runHerdrJson(operation, args);
	if (!isRecord(envelope)) {
		throw new Error(`Herdr ${operation} returned malformed API envelope`);
	}
	const result = envelope.result;
	if (!isRecord(result)) {
		throw new Error(`Herdr ${operation} returned malformed API envelope: missing result`);
	}
	return result;
}

function parsePane(value: unknown, operation: string): HerdrPane {
	if (!isRecord(value)) {
		throw new Error(`Herdr ${operation} returned malformed pane record`);
	}
	const paneId = stringField(value, "pane_id");
	if (!paneId) {
		throw new Error(`Herdr ${operation} returned pane without pane_id`);
	}
	return {
		paneId,
		tabId: stringField(value, "tab_id"),
		workspaceId: stringField(value, "workspace_id"),
		terminalId: stringField(value, "terminal_id"),
		cwd: stringField(value, "cwd"),
		foregroundCwd: stringField(value, "foreground_cwd"),
		focused: booleanField(value, "focused"),
	};
}

function parseTab(value: unknown, operation: string): HerdrTab {
	if (!isRecord(value)) {
		throw new Error(`Herdr ${operation} returned malformed tab record`);
	}
	const tabId = stringField(value, "tab_id");
	if (!tabId) {
		throw new Error(`Herdr ${operation} returned tab without tab_id`);
	}
	return {
		tabId,
		workspaceId: stringField(value, "workspace_id"),
		label: stringField(value, "label"),
		focused: booleanField(value, "focused"),
		paneCount: numberField(value, "pane_count"),
	};
}

function parseWorkspace(value: unknown, operation: string): HerdrWorkspace {
	if (!isRecord(value)) {
		throw new Error(`Herdr ${operation} returned malformed workspace record`);
	}
	const workspaceId = stringField(value, "workspace_id");
	if (!workspaceId) {
		throw new Error(
			`Herdr ${operation} returned workspace without workspace_id`,
		);
	}
	return {
		workspaceId,
		activeTabId: stringField(value, "active_tab_id"),
		label: stringField(value, "label"),
		focused: booleanField(value, "focused"),
		tabCount: numberField(value, "tab_count"),
		paneCount: numberField(value, "pane_count"),
	};
}

export function getHerdrServerStatus(): HerdrServerStatus {
	const value = runHerdrJson("status server", ["status", "server", "--json"]);
	if (!isRecord(value)) {
		throw new Error("Herdr status server returned malformed status record");
	}
	return {
		status: stringField(value, "status"),
		running: booleanField(value, "running") === true,
		compatible: booleanField(value, "compatible") === true,
		protocol: numberField(value, "protocol"),
		version: stringField(value, "version"),
		capabilities: isRecord(value.capabilities) ? value.capabilities : undefined,
	};
}

export function getHerdrCurrentPane(): HerdrPane {
	const result = runHerdrApi("pane current", ["pane", "current", "--current"]);
	return parsePane(result.pane, "pane current");
}

export function getHerdrTab(tabId: string): HerdrTab {
	const result = runHerdrApi("tab get", ["tab", "get", tabId]);
	return parseTab(result.tab, "tab get");
}

export function getHerdrWorkspace(workspaceId: string): HerdrWorkspace {
	const result = runHerdrApi("workspace get", ["workspace", "get", workspaceId]);
	return parseWorkspace(result.workspace, "workspace get");
}

export function isHerdrRuntimeAvailable(
	hasCommand: (command: string) => boolean = (command) =>
		defaultMuxRuntimeProbe.hasCommand(command),
): boolean {
	if (!hasCommand("herdr")) return false;
	try {
		const status = getHerdrServerStatus();
		if (!status.running || !status.compatible) return false;
		getHerdrCurrentPane();
		return true;
	} catch {
		return false;
	}
}
