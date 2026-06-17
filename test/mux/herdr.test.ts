import {
	assert,
	createSurface,
	createSurfaceSplit,
	createTestDir,
	describe,
	it,
	join,
	readFileSync,
	writeExecutable,
	writeFileSync,
	getMuxBackend,
	isHerdrAvailable,
	isMuxAvailable,
	muxSetupHint,
} from "../support/index.ts";
import {
	getHerdrCurrentPane,
	getHerdrServerStatus,
	getHerdrTab,
	getHerdrWorkspace,
} from "../../src/mux/herdr.ts";

function clearMuxRuntimeEnv(): void {
	delete process.env.CMUX_SOCKET_PATH;
	delete process.env.CMUX_SURFACE_ID;
	delete process.env.TMUX;
	delete process.env.TMUX_PANE;
	delete process.env.WEZTERM_PANE;
	delete process.env.WEZTERM_UNIX_SOCKET;
	delete process.env.ZELLIJ;
	delete process.env.ZELLIJ_SESSION_NAME;
	delete process.env.HERDR_PANE_ID;
	delete process.env.HERDR_TAB_ID;
	delete process.env.HERDR_WORKSPACE_ID;
	delete process.env.PI_SUBAGENT_MUX;
}

function writeFakeHerdr(dir: string): string {
	const logFile = join(dir, "herdr.log");
	writeFileSync(logFile, "");
	writeExecutable(
		dir,
		"herdr",
		`#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_HERDR_LOG"
cmd="$*"
mode="\${FAKE_HERDR_MODE:-available}"

if [ "$cmd" = "status server --json" ]; then
  case "$mode" in
    stopped)
      printf '%s\n' '{"status":"stopped","running":false,"compatible":true,"protocol":14,"version":"0.7.0"}'
      ;;
    incompatible)
      printf '%s\n' '{"status":"running","running":true,"compatible":false,"protocol":13,"version":"0.6.0"}'
      ;;
    malformed-status)
      printf '%s\n' 'not-json'
      ;;
    *)
      printf '%s\n' '{"status":"running","running":true,"compatible":true,"protocol":14,"version":"0.7.0","capabilities":{"live_handoff":true}}'
      ;;
  esac
  exit 0
fi

if [ "$cmd" = "pane current --current" ]; then
  case "$mode" in
    no-current)
      printf '%s\n' '{"error":{"code":"current_pane_not_found","message":"no current Herdr pane"},"id":"cli:pane:current"}'
      exit 1
      ;;
    api-error)
      printf '%s\n' '{"error":{"code":"boom","message":"fake current failed"},"id":"cli:pane:current"}'
      exit 1
      ;;
    malformed-current)
      printf '%s\n' 'this is not json'
      exit 0
      ;;
    *)
      printf '%s\n' '{"id":"cli:pane:current","result":{"type":"pane_current","pane":{"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1","terminal_id":"term_fake","cwd":"/workspace","foreground_cwd":"/workspace/app","focused":true}}}'
      exit 0
      ;;
  esac
fi

if [ "$cmd" = "tab get w1:t1" ]; then
  printf '%s\n' '{"id":"cli:tab:get","result":{"type":"tab_info","tab":{"tab_id":"w1:t1","workspace_id":"w1","label":"One","focused":true,"pane_count":1}}}'
  exit 0
fi

if [ "$cmd" = "workspace get w1" ]; then
  printf '%s\n' '{"id":"cli:workspace:get","result":{"type":"workspace_info","workspace":{"workspace_id":"w1","active_tab_id":"w1:t1","label":"Main","focused":true,"tab_count":1,"pane_count":1}}}'
  exit 0
fi

if [ "$1" = "tab" ] && [ "$2" = "create" ]; then
  printf '%s\n' '{"id":"cli:tab:create","result":{"type":"tab_created","tab":{"tab_id":"w1:t2","workspace_id":"w1","label":"Child","focused":false,"pane_count":1},"pane":{"pane_id":"w1:p2","tab_id":"w1:t2","workspace_id":"w1","cwd":"/workspace/app","focused":false}}}'
  exit 0
fi

if [ "$1" = "pane" ] && [ "$2" = "split" ]; then
  direction=""
  previous=""
  for arg in "$@"; do
    if [ "$previous" = "--direction" ]; then direction="$arg"; fi
    previous="$arg"
  done
  printf '%s\n' '{"id":"cli:pane:split","result":{"type":"pane_split","pane":{"pane_id":"w1:p-split-'"$direction"'","tab_id":"w1:t1","workspace_id":"w1","cwd":"/workspace/app","focused":false}}}'
  exit 0
fi

printf '%s\n' '{"error":{"code":"unknown_command","message":"unsupported fake herdr command"}}'
exit 1
`,
	);
	return logFile;
}

function useFakeHerdr(mode = "available"): { dir: string; logFile: string } {
	const dir = createTestDir();
	const logFile = writeFakeHerdr(dir);
	clearMuxRuntimeEnv();
	process.env.PATH = dir;
	process.env.FAKE_HERDR_LOG = logFile;
	process.env.FAKE_HERDR_MODE = mode;
	return { dir, logFile };
}

function writeFakeCommand(dir: string, command: string): void {
	writeExecutable(dir, command, "#!/bin/sh\nexit 0\n");
}

describe("Herdr mux backend", () => {
	describe("backend selection", () => {
		it("selects Herdr when a compatible server and current pane are available", () => {
			useFakeHerdr();

			assert.equal(isHerdrAvailable(), true);
			assert.equal(isMuxAvailable(), true);
			assert.equal(getMuxBackend(), "herdr");
		});

		it("does not select Herdr when the herdr command is missing", () => {
			const dir = createTestDir();
			clearMuxRuntimeEnv();
			process.env.PATH = dir;

			assert.equal(isHerdrAvailable(), false);
			assert.equal(getMuxBackend(), null);
		});

		for (const [mode, expected] of [
			["no-current", "current pane"],
			["stopped", "stopped server"],
			["incompatible", "incompatible protocol"],
		] as const) {
			it(`does not select Herdr with ${expected}`, () => {
				useFakeHerdr(mode);

				assert.equal(isHerdrAvailable(), false);
				assert.equal(getMuxBackend(), null);
			});
		}

		it("prefers Herdr over an outer tmux when no forced preference is set", () => {
			const { dir } = useFakeHerdr();
			writeFakeCommand(dir, "tmux");
			process.env.TMUX = "fake-tmux-socket";
			process.env.TMUX_PANE = "%1";

			assert.equal(getMuxBackend(), "herdr");
		});

		it("uses forced Herdr only when Herdr is actually available", () => {
			useFakeHerdr();
			process.env.PI_SUBAGENT_MUX = "herdr";
			assert.equal(getMuxBackend(), "herdr");

			useFakeHerdr("no-current");
			process.env.PI_SUBAGENT_MUX = "herdr";
			assert.equal(getMuxBackend(), null);
		});

		for (const { backend, command, envKey, envValue } of [
			{
				backend: "cmux",
				command: "cmux",
				envKey: "CMUX_SOCKET_PATH",
				envValue: "/tmp/fake-cmux.sock",
			},
			{
				backend: "tmux",
				command: "tmux",
				envKey: "TMUX",
				envValue: "fake-tmux-socket",
			},
			{
				backend: "zellij",
				command: "zellij",
				envKey: "ZELLIJ_SESSION_NAME",
				envValue: "fake-zellij",
			},
			{
				backend: "wezterm",
				command: "wezterm",
				envKey: "WEZTERM_UNIX_SOCKET",
				envValue: "fake-wezterm-socket",
			},
		] as const) {
			it(`respects forced ${backend} preference over available Herdr`, () => {
				const { dir } = useFakeHerdr();
				writeFakeCommand(dir, command);
				process.env.PI_SUBAGENT_MUX = backend;
				process.env[envKey] = envValue;

				assert.equal(getMuxBackend(), backend);
			});
		}

		it("returns a Herdr-specific setup hint", () => {
			process.env.PI_SUBAGENT_MUX = "herdr";

			assert.match(muxSetupHint(), /Herdr/);
		});
	});

	describe("surface creation", () => {
		it("creates normal surfaces as non-shrinking Herdr tabs", () => {
			const { logFile } = useFakeHerdr();
			process.env.PI_SUBAGENT_MUX = "herdr";

			assert.equal(createSurface("Herdr Child"), "w1:p2");

			const log = readFileSync(logFile, "utf8");
			assert.match(
				log,
				/tab create --workspace w1 --cwd .* --label Herdr Child --no-focus/,
			);
			assert.doesNotMatch(log, /pane split/);
		});

		for (const direction of ["right", "down"] as const) {
			it(`creates explicit ${direction} Herdr splits with cwd and no-focus`, () => {
				const { logFile } = useFakeHerdr();
				process.env.PI_SUBAGENT_MUX = "herdr";

				assert.equal(
					createSurfaceSplit("Herdr Split", direction, "w1:p1"),
					`w1:p-split-${direction}`,
				);

				const log = readFileSync(logFile, "utf8");
				assert.match(
					log,
					new RegExp(
						`pane split w1:p1 --direction ${direction} --cwd .* --no-focus`,
					),
				);
				assert.doesNotMatch(log, /tab create/);
			});
		}

		for (const direction of ["left", "up"] as const) {
			it(`rejects unsupported ${direction} Herdr splits honestly`, () => {
				const { logFile } = useFakeHerdr();
				process.env.PI_SUBAGENT_MUX = "herdr";

				assert.throws(
					() => createSurfaceSplit("Herdr Split", direction, "w1:p1"),
					new RegExp(
						`Herdr split direction "${direction}" is unsupported; .*right and down`,
					),
				);

				const log = readFileSync(logFile, "utf8");
				assert.doesNotMatch(log, /pane split/);
			});
		}
	});

	describe("structured CLI adapter", () => {
		it("extracts typed status, pane, tab, and workspace records", () => {
			useFakeHerdr();

			assert.deepEqual(getHerdrServerStatus(), {
				status: "running",
				running: true,
				compatible: true,
				protocol: 14,
				version: "0.7.0",
				capabilities: { live_handoff: true },
			});
			assert.deepEqual(getHerdrCurrentPane(), {
				paneId: "w1:p1",
				tabId: "w1:t1",
				workspaceId: "w1",
				terminalId: "term_fake",
				cwd: "/workspace",
				foregroundCwd: "/workspace/app",
				focused: true,
			});
			assert.deepEqual(getHerdrTab("w1:t1"), {
				tabId: "w1:t1",
				workspaceId: "w1",
				label: "One",
				focused: true,
				paneCount: 1,
			});
			assert.deepEqual(getHerdrWorkspace("w1"), {
				workspaceId: "w1",
				activeTabId: "w1:t1",
				label: "Main",
				focused: true,
				tabCount: 1,
				paneCount: 1,
			});

			const log = readFileSync(process.env.FAKE_HERDR_LOG!, "utf8");
			assert.match(log, /status server --json/);
			assert.match(log, /pane current --current/);
			assert.match(log, /tab get w1:t1/);
			assert.match(log, /workspace get w1/);
		});

		it("reports Herdr API errors with the failing operation name", () => {
			useFakeHerdr("api-error");

			assert.throws(
				() => getHerdrCurrentPane(),
				/Herdr pane current failed: boom: fake current failed/,
			);
		});

		it("reports malformed JSON with the failing operation name", () => {
			useFakeHerdr("malformed-current");

			assert.throws(
				() => getHerdrCurrentPane(),
				/Herdr pane current returned malformed JSON/,
			);
		});

		it("reports malformed server status JSON with the status operation name", () => {
			useFakeHerdr("malformed-status");

			assert.throws(
				() => getHerdrServerStatus(),
				/Herdr status server returned malformed JSON/,
			);
		});
	});
});
