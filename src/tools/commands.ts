import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { findRunningSubagent } from "../runtime/running-registry.ts";
import type { RunningSubagent } from "../types.ts";

export interface SubagentCommandRuntime {
	stopRunningSubagent(running: RunningSubagent): void;
}

export function registerSubagentCommands(
	pi: ExtensionAPI,
	runtime: SubagentCommandRuntime,
): void {
	pi.registerCommand("subagent-kill", {
		description: "Stop a running subagent: /subagent-kill <id|name>",
		handler: async (args, ctx) => {
			const query = (args ?? "").trim();
			if (!query) {
				ctx.ui.notify("Usage: /subagent-kill <id|name>", "warning");
				return;
			}

			const match = findRunningSubagent(query);
			if (!match.running) {
				ctx.ui.notify(match.error ?? "Subagent not found.", "error");
				return;
			}

			runtime.stopRunningSubagent(match.running);
			ctx.ui.notify(
				`Stopping subagent "${match.running.name}" (${match.running.id})`,
				"info",
			);
		},
	});
}
