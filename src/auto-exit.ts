export interface SubagentErrorInfo {
	errorMessage: string;
	stopReason: "error";
}

/**
 * If the last assistant message ended with stopReason: "error"
 * (auto-retry exhausted on overload / rate limit / server error),
 * return its error info so the parent can surface a clear failure.
 */
export function findLatestAssistantError(
	messages: any[] | undefined,
): SubagentErrorInfo | null {
	if (!messages) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant") continue;
		if (msg.stopReason !== "error") return null;
		const raw =
			typeof msg.errorMessage === "string" ? msg.errorMessage.trim() : "";
		return {
			errorMessage:
				raw ||
				"Subagent agent loop ended with stopReason=error (no errorMessage field).",
			stopReason: "error",
		};
	}
	return null;
}

export function shouldMarkUserTookOver(agentStarted: boolean): boolean {
	return agentStarted;
}

type AgentMessageLike = {
	role?: string;
	stopReason?: string;
};

export function shouldAutoExitOnAgentEnd(
	userTookOver: boolean,
	messages: AgentMessageLike[] | undefined,
): boolean {
	if (userTookOver) return false;

	if (messages) {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role === "assistant") {
				return msg.stopReason !== "aborted";
			}
		}
	}

	return true;
}
