/**
 * dsh-gitbash-win — browser half (classic script, not an ES module).
 *
 * Registers the "Git Bash" card in Settings → Plugins while the Host serves the
 * `gitbash-win` configuration namespace. The card edits bashPath / initScript /
 * timeoutMs / maxOutputBytes through `ctx.configForms.get('gitbash-win')` and
 * shows the live detection report from `GET /dsh-gitbash-win/status`.
 *
 * Contract: DESIGN.md §7 (card) and §6.1 (status JSON).
 *
 * Safety: `sandboxFallback` is a fail-closed safety setting owned by
 * cordis.patch.yml. It is intentionally NOT editable in this UI (it is shown
 * read-only, from the status report, with a pointer to the docs).
 */
window.__ModuleLoader__.load({
  id: "dsh-gitbash-win",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = "settings.gitbash-win";
    /** Host configuration namespace (profile row id); also the configForms key. */
    const CONFIG_NS = "gitbash-win";
    /** Detection status route served by the host half (DESIGN.md §6.1). */
    const STATUS_PATH = "/dsh-gitbash-win/status";

    /** English copy. */
    const en = {
      title: "Git Bash",
      description: "Choose Git for Windows bash as the agent's command shell on Windows.",
      statusHeading: "Detection",
      detecting: "Detecting Git Bash…",
      detectFailed: "Could not read the detection status",
      redetect: "Re-detect",
      detected: "Detected",
      notDetected: "Not detected",
      resolvedPath: "Resolved path",
      configuredPath: "Configured path",
      source: "Source",
      sourceConfigured: "Configured path",
      sourceKnownDir: "Known folder",
      sourcePath: "PATH",
      sourceGitSibling: "Next to git.exe",
      sourceRegistry: "Registry",
      sourceUnknown: "Unknown",
      candidates: "Candidates",
      candidateOk: "usable",
      candidateFailed: "unusable",
      platform: "Platform",
      unsupportedPlatform: "This plugin is Windows-only (current platform: {platform}).",
      sandboxHeading: "Sandbox",
      sandboxMode: "Default mode",
      sandboxFallback: "Fallback (read-only)",
      sandboxUnavailable: "unavailable",
      toolHeading: "Tool",
      toolName: "Tool name",
      toolGlobal: "global",
      fieldsHeading: "Settings",
      bashPath: "bash.exe path",
      bashPathHint: "Leave empty to auto-detect Git for Windows. WSL aliases are rejected.",
      bashPathPlaceholder: "Auto-detect",
      initScript: "Initialization script (BASH_ENV)",
      initScriptHint: "Optional script passed as BASH_ENV; ~ is expanded. Leave empty to disable.",
      initScriptPlaceholder: "e.g. ~/.dsh/gitbash-init.sh",
      timeoutMs: "Command timeout (ms)",
      timeoutMsHint: "How long one command may run before it is terminated.",
      maxOutputBytes: "Output cap per stream (bytes)",
      maxOutputBytesHint: "Output beyond this cap spills to a temporary file rather than being lost.",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      saveFailed: "The deployment did not accept these values; they were left for you to correct.",
      resetToDefault: "Reset to default",
      resetDone: "Defaults restored",
      invalidNumber: "Enter a positive number, or leave blank to use the default.",
      readOnly: "This deployment stores settings read-only.",
      unavailable: "This plugin is not loaded, so it cannot be configured right now.",
      loading: "Loading settings…",
      sandboxFallbackNote: "sandboxFallback is intentionally not editable here (safety). Set it in cordis.patch.yml; see the docs.",
    };

    /** Japanese copy (primary locale; checked against the English keys). */
    const ja = {
      title: "Git Bash",
      description: "Windows でエージェントのコマンド実行シェルに Git for Windows の bash を使います。",
      statusHeading: "検出状態",
      detecting: "Git Bash を検出しています…",
      detectFailed: "検出状態を取得できませんでした",
      redetect: "再検出",
      detected: "検出済み",
      notDetected: "未検出",
      resolvedPath: "解決済みパス",
      configuredPath: "設定されたパス",
      source: "検出元",
      sourceConfigured: "設定値",
      sourceKnownDir: "既知のフォルダー",
      sourcePath: "PATH",
      sourceGitSibling: "git.exe と同じ場所",
      sourceRegistry: "レジストリ",
      sourceUnknown: "不明",
      candidates: "候補",
      candidateOk: "利用可能",
      candidateFailed: "利用不可",
      platform: "プラットフォーム",
      unsupportedPlatform: "このプラグインは Windows 専用です（現在のプラットフォーム: {platform}）。",
      sandboxHeading: "サンドボックス",
      sandboxMode: "既定モード",
      sandboxFallback: "フォールバック（読み取り専用）",
      sandboxUnavailable: "利用不可",
      toolHeading: "ツール",
      toolName: "ツール名",
      toolGlobal: "グローバル",
      fieldsHeading: "設定",
      bashPath: "bash.exe のパス",
      bashPathHint: "空欄なら Git for Windows を自動検出します。WSL のエイリアスは拒否されます。",
      bashPathPlaceholder: "自動検出",
      initScript: "初期化スクリプト (BASH_ENV)",
      initScriptHint: "BASH_ENV として渡す任意のスクリプト。~ は展開されます。空欄で無効。",
      initScriptPlaceholder: "例: ~/.dsh/gitbash-init.sh",
      timeoutMs: "コマンドのタイムアウト (ms)",
      timeoutMsHint: "1 つのコマンドが強制終了されるまでに実行できる時間。",
      maxOutputBytes: "ストリームごとの出力上限 (バイト)",
      maxOutputBytesHint: "この上限を超えた出力は失われず、一時ファイルに書き出されます。",
      save: "保存",
      saving: "保存中…",
      saved: "保存しました",
      saveFailed: "デプロイがこれらの値を受け付けませんでした。修正できるよう残しています。",
      resetToDefault: "デフォルトに戻す",
      resetDone: "デフォルトに戻しました",
      invalidNumber: "正の数値を入力するか、空欄でデフォルトを使用します。",
      readOnly: "このデプロイでは設定は読み取り専用です。",
      unavailable: "このプラグインは読み込まれていないため、現在設定できません。",
      loading: "設定を読み込んでいます…",
      sandboxFallbackNote: "sandboxFallback は安全設定のためこの画面では変更できません。cordis.patch.yml で設定してください（docs を参照）。",
    };

    /**
     * The only fields this card edits. `sandboxFallback` is deliberately absent:
     * it is a fail-closed safety setting configured in cordis.patch.yml only.
     *
     * @type {{ key: string, kind: "string" | "number" }[]}
     */
    const FIELDS = [
      { key: "bashPath", kind: "string" },
      { key: "initScript", kind: "string" },
      { key: "timeoutMs", kind: "number" },
      { key: "maxOutputBytes", kind: "number" },
    ];

    /** Placeholders for numeric fields; the host schema owns the real defaults. */
    const NUMBER_PLACEHOLDERS = Object.freeze({ timeoutMs: "120000", maxOutputBytes: "64000" });

    /** Maps the host's detection source id to a dictionary key. */
    const SOURCE_KEYS = Object.freeze({
      configured: "sourceConfigured",
      "known-dir": "sourceKnownDir",
      path: "sourcePath",
      "git-sibling": "sourceGitSibling",
      registry: "sourceRegistry",
    });

    const STYLES = Object.freeze({
      card: { display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px", lineHeight: 1.5 },
      row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
      column: { display: "flex", flexDirection: "column", gap: "6px" },
      heading: { margin: 0, fontSize: "13px", fontWeight: 600 },
      hint: { margin: 0, color: "var(--dsw-alias-label-tertiary, #6b7280)", fontSize: "12px", lineHeight: 1.5 },
      field: { display: "flex", flexDirection: "column", gap: "4px" },
      label: { fontSize: "12.5px", fontWeight: 500 },
      input: {
        height: "32px",
        padding: "0 10px",
        border: "0.5px solid var(--dsw-alias-border-l4, #c8c8c8)",
        borderRadius: "6px",
        background: "var(--dsw-alias-bg-layer-3, transparent)",
        color: "inherit",
        font: "inherit",
      },
      fact: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" },
      code: {
        fontFamily: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        overflowWrap: "anywhere",
      },
      list: { margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "2px" },
      footer: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" },
      banner: {
        margin: 0,
        padding: "8px 12px",
        borderRadius: "6px",
        background: "var(--dsw-alias-bg-module-platform, rgba(0, 0, 0, 0.05))",
      },
      error: { margin: 0, color: "var(--dsw-alias-state-error-primary, #b3261e)", fontSize: "12px" },
      saved: { margin: 0, color: "var(--dsw-alias-state-success-primary, #1e7b34)", fontSize: "12px" },
    });

    // ---------------------------------------------------------------------
    // Pure helpers (exported through __internals for the harness tests).
    // ---------------------------------------------------------------------

    /** @returns {boolean} whether the value is a non-array object. */
    function isObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    /** @returns {string} a display-safe string, never "null"/"undefined". */
    function asText(value) {
      if (value === null || value === undefined) return "";
      return String(value);
    }

    /** @returns {string} a readable message for any thrown value. */
    function errorText(error) {
      if (error instanceof Error) return error.message;
      try {
        return String(error);
      } catch {
        return "unknown error";
      }
    }

    /** @returns {string} the dictionary key describing one detection source id. */
    function sourceKey(source) {
      if (typeof source !== "string") return "sourceUnknown";
      return SOURCE_KEYS[source] ?? "sourceUnknown";
    }

    /**
     * Build the editable draft from a config-form snapshot.
     *
     * @param {object | undefined} snapshot - the ConfigFormController snapshot.
     * @returns {Record<string, string>} text values keyed by field.
     */
    function draftFromSnapshot(snapshot) {
      const value = isObject(snapshot) && isObject(snapshot.value) ? snapshot.value : {};
      const draft = {};
      for (const field of FIELDS) {
        const current = value[field.key];
        if (field.kind === "number") {
          draft[field.key] = typeof current === "number" && Number.isFinite(current) ? String(current) : "";
        } else {
          draft[field.key] = typeof current === "string" ? current : "";
        }
      }
      return draft;
    }

    /**
     * Parse one numeric draft text.
     *
     * @param {unknown} value - the raw draft text.
     * @returns {{ kind: "empty" } | { kind: "invalid" } | { kind: "number", value: number }}
     */
    function parseNumberText(value) {
      const text = asText(value).trim();
      if (text === "") return { kind: "empty" };
      const parsed = Number(text);
      if (!Number.isFinite(parsed) || parsed <= 0) return { kind: "invalid" };
      return { kind: "number", value: parsed };
    }

    /**
     * Validate the numeric drafts; empty is valid (it means "use the default").
     *
     * @param {Record<string, string>} draft - the editable draft.
     * @returns {Record<string, true>} invalid fields keyed by field name.
     */
    function validateDraft(draft) {
      const errors = {};
      for (const field of FIELDS) {
        if (field.kind !== "number") continue;
        if (parseNumberText(draft[field.key]).kind === "invalid") errors[field.key] = true;
      }
      return errors;
    }

    /** @returns {boolean} whether the Host reports a user override for the field. */
    function hasUserField(snapshot, key) {
      if (!isObject(snapshot) || !isObject(snapshot.user)) return false;
      return Object.prototype.hasOwnProperty.call(snapshot.user, key);
    }

    /**
     * Build the single mutate() operation list for a Save: changed fields get a
     * set op, fields the user cleared get an unset op that releases the override.
     * Unchanged fields get no op, so a save never rewrites the rest of the row.
     *
     * @param {Record<string, string>} draft - the editable draft.
     * @param {object | undefined} snapshot - the config-form snapshot.
     * @returns {{ op: "set" | "unset", path: string[], value?: unknown }[]} operations.
     */
    function buildOps(draft, snapshot) {
      const value = isObject(snapshot) && isObject(snapshot.value) ? snapshot.value : {};
      const ops = [];
      for (const field of FIELDS) {
        const key = field.key;
        const current = value[key];
        if (field.kind === "number") {
          const parsed = parseNumberText(draft[key]);
          if (parsed.kind === "invalid") continue;
          if (parsed.kind === "empty") {
            if (hasUserField(snapshot, key)) ops.push({ op: "unset", path: [key] });
            continue;
          }
          if (typeof current === "number" && current === parsed.value) continue;
          ops.push({ op: "set", path: [key], value: parsed.value });
          continue;
        }
        const next = asText(draft[key]).trim();
        const now = typeof current === "string" ? current : "";
        if (next === now) continue;
        if (next === "") {
          if (hasUserField(snapshot, key)) ops.push({ op: "unset", path: [key] });
          continue;
        }
        ops.push({ op: "set", path: [key], value: next });
      }
      return ops;
    }

    /**
     * Build the unset operations that release every user override this card owns.
     *
     * @param {object | undefined} snapshot - the config-form snapshot.
     * @returns {{ op: "unset", path: string[] }[]} operations.
     */
    function buildResetOps(snapshot) {
      const ops = [];
      for (const field of FIELDS) {
        if (hasUserField(snapshot, field.key)) ops.push({ op: "unset", path: [field.key] });
      }
      return ops;
    }

    /**
     * Read the detection status from the same-origin host route (GET only, no
     * body, no credentials beyond the page's own session cookie).
     *
     * @param {typeof fetch | undefined} [fetchImpl] - optional fetch override.
     * @param {string} [path] - optional route path override.
     * @returns {Promise<object>} the status JSON object.
     */
    async function requestStatus(fetchImpl, path) {
      const target = typeof path === "string" && path !== "" ? path : STATUS_PATH;
      const globalObject = typeof globalThis !== "undefined" ? globalThis : undefined;
      const impl = typeof fetchImpl === "function" ? fetchImpl : globalObject !== undefined && typeof globalObject.fetch === "function" ? globalObject.fetch : undefined;
      if (impl === undefined) throw new Error("fetch() is not available in this browser");
      const response = await impl.call(globalObject, target, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response === null || typeof response !== "object") throw new Error("status request returned no response");
      if (response.ok === false) {
        const code = typeof response.status === "number" ? " (HTTP " + response.status + ")" : "";
        throw new Error("status request failed" + code);
      }
      if (typeof response.json !== "function") throw new Error("status response was not JSON");
      const body = await response.json();
      if (!isObject(body)) throw new Error("status response was not a JSON object");
      return body;
    }

    // ---------------------------------------------------------------------
    // Rendering helpers (plain createElement, no primitives dependency).
    // ---------------------------------------------------------------------

    /** @returns {object} a section heading element. */
    function heading(text) {
      return h("h4", { className: "gitbash-win-heading", style: STYLES.heading }, text);
    }

    /** @returns {object} one label/value fact row. */
    function fact(label, value) {
      return h(
        "div",
        { className: "gitbash-win-fact", style: STYLES.fact },
        h("span", { className: "gitbash-win-fact-label" }, label),
        h("code", { className: "gitbash-win-fact-value", style: STYLES.code }, value),
      );
    }

    /** @returns {object} one labeled input row. */
    function fieldElement(labelText, id, hintText, inputProps) {
      return h(
        "label",
        { className: "gitbash-win-field", htmlFor: id, style: STYLES.field },
        h("span", { className: "gitbash-win-label", style: STYLES.label }, labelText),
        h("input", { id, className: "gitbash-win-input", style: STYLES.input, ...inputProps }),
        hintText === undefined || hintText === null || hintText === "" ? null : h(
          "span",
          { className: "gitbash-win-hint", style: STYLES.hint },
          hintText,
        ),
      );
    }

    /**
     * Render the detection status block.
     *
     * @param {(key: string, params?: Record<string, string>) => string} t - locale reader.
     * @param {{ phase: "loading" | "ready" | "error", data?: object, message?: string }} detection - status state.
     * @param {() => void} onRedetect - re-detect handler.
     * @returns {object} the status section element.
     */
    function renderStatus(t, detection, onRedetect) {
      const children = [
        h(
          "div",
          { className: "gitbash-win-status-head", style: STYLES.row },
          heading(t("statusHeading")),
          h(
            "button",
            {
              type: "button",
              id: "gitbash-win-redetect",
              className: "gitbash-win-button gitbash-win-redetect",
              disabled: detection.phase === "loading",
              onClick: onRedetect,
            },
            t("redetect"),
          ),
        ),
      ];
      if (detection.phase === "loading") {
        children.push(h("p", { className: "gitbash-win-hint", role: "status", style: STYLES.hint }, t("detecting")));
      } else if (detection.phase === "error") {
        children.push(
          h(
            "p",
            { className: "gitbash-win-error", role: "alert", style: STYLES.error },
            t("detectFailed") + ": " + asText(detection.message),
          ),
        );
      } else {
        const data = isObject(detection.data) ? detection.data : {};
        const bashPath = isObject(data.bashPath) ? data.bashPath : {};
        const sandbox = isObject(data.sandbox) ? data.sandbox : {};
        const tool = isObject(data.tool) ? data.tool : {};
        if (data.supported === false) {
          children.push(
            h(
              "p",
              { className: "gitbash-win-error", role: "status", style: STYLES.error },
              t("unsupportedPlatform", { platform: asText(data.platform) }),
            ),
          );
        } else if (data.platform !== undefined) {
          children.push(fact(t("platform"), asText(data.platform)));
        }
        if (asText(bashPath.configured) !== "") children.push(fact(t("configuredPath"), asText(bashPath.configured)));
        children.push(fact(t("resolvedPath"), asText(bashPath.resolved) !== "" ? asText(bashPath.resolved) : t("notDetected")));
        children.push(
          h(
            "p",
            { className: "gitbash-win-detection-state", style: { margin: 0, fontSize: "12px" } },
            bashPath.ok === true ? t("detected") : t("notDetected"),
          ),
        );
        if (typeof bashPath.source === "string" && bashPath.source !== "") {
          children.push(fact(t("source"), t(sourceKey(bashPath.source))));
        }
        const candidates = Array.isArray(bashPath.candidates) ? bashPath.candidates : [];
        if (candidates.length > 0) {
          children.push(
            h(
              "div",
              { className: "gitbash-win-candidates", style: STYLES.column },
              h("span", { className: "gitbash-win-label", style: STYLES.label }, t("candidates")),
              h(
                "ul",
                { className: "gitbash-win-candidate-list", style: STYLES.list },
                candidates.map((candidate, index) => {
                  const item = isObject(candidate) ? candidate : {};
                  const state = item.ok === true
                    ? t("candidateOk")
                    : typeof item.reason === "string" && item.reason !== ""
                      ? item.reason
                      : t("candidateFailed");
                  return h(
                    "li",
                    { className: "gitbash-win-candidate", key: "candidate-" + index },
                    h("code", { style: STYLES.code }, asText(item.path)),
                    " — ",
                    h("span", { style: item.ok === true ? undefined : STYLES.error }, state),
                  );
                }),
              ),
            ),
          );
        }
        children.push(heading(t("sandboxHeading")));
        children.push(fact(t("sandboxMode"), asText(sandbox.defaultMode) !== "" ? asText(sandbox.defaultMode) : t("sandboxUnavailable")));
        if (sandbox.fallback !== undefined) children.push(fact(t("sandboxFallback"), asText(sandbox.fallback)));
        children.push(heading(t("toolHeading")));
        children.push(
          fact(
            t("toolName"),
            asText(tool.name) + (tool.global === true ? " (" + t("toolGlobal") + ")" : ""),
          ),
        );
        children.push(h("p", { className: "gitbash-win-hint", style: STYLES.hint }, t("sandboxFallbackNote")));
      }
      return h(
        "section",
        { className: "gitbash-win-status", "data-role": "gitbash-win-status", style: STYLES.column },
        ...children.filter((child) => child !== null && child !== undefined && child !== false),
      );
    }

    // ---------------------------------------------------------------------
    // The card component.
    // ---------------------------------------------------------------------

    /**
     * The Git Bash settings card. Renders the detection report and the four
     * editable fields; `props.view === 'summary'` returns the one-line
     * description instead (used on the Plugins list).
     *
     * The slot registration injects:
     * - `hooks: { configForm }` → `props.useConfigForm(selector)` (reactive snapshot)
     * - `configForm` (the ConfigFormController itself, for mutate())
     * - `api` ({ statusPath, configNamespace })
     *
     * `props.form` is also provided by the Plugins page for page views; it is
     * deliberately not used because the page-owned wrapper shadows same-named
     * injected props (the injected `configForm` is the dedicated one).
     *
     * @param {object} props - slot props (t, view, injected face, ...).
     * @returns {string | object} summary text or the card element.
     */
    function Card(props) {
      const t = props.t;
      const api = isObject(props.api) ? props.api : {};
      const statusPath = typeof api.statusPath === "string" ? api.statusPath : STATUS_PATH;
      const fetchImpl = typeof api.fetch === "function" ? api.fetch : undefined;
      const form = isObject(props.configForm) && typeof props.configForm.mutate === "function" ? props.configForm : undefined;
      const injectedState = typeof props.useConfigForm === "function" ? props.useConfigForm((snapshot) => snapshot) : undefined;
      const snapshot = isObject(injectedState)
        ? injectedState
        : form !== undefined && typeof form.getSnapshot === "function"
          ? form.getSnapshot()
          : undefined;

      const [draft, setDraft] = react.useState(() => draftFromSnapshot(snapshot));
      const [feedback, setFeedback] = react.useState({ phase: "idle" });
      const [detection, setDetection] = react.useState({ phase: "loading" });
      const [detectNonce, setDetectNonce] = react.useState(0);

      const snapshotStatus = isObject(snapshot) ? snapshot.status : undefined;
      const snapshotRevision = isObject(snapshot) ? snapshot.revision : undefined;

      // Re-seed the draft whenever the Host answers with a new revision (initial
      // load, accepted save/reset, external edit). User edits never touch the
      // snapshot, so in-progress typing is preserved.
      react.useEffect(() => {
        if (snapshotStatus !== "ready") return;
        setDraft(draftFromSnapshot(snapshot));
      }, [snapshotStatus, snapshotRevision]);

      // Status is fetched on the page view only; the summary card skips the call.
      react.useEffect(() => {
        if (props.view !== "page") return undefined;
        let cancelled = false;
        setDetection({ phase: "loading" });
        requestStatus(fetchImpl, statusPath).then(
          (data) => {
            if (!cancelled) setDetection({ phase: "ready", data });
          },
          (error) => {
            if (!cancelled) setDetection({ phase: "error", message: errorText(error) });
          },
        );
        return () => {
          cancelled = true;
        };
      }, [props.view, statusPath, detectNonce, fetchImpl]);

      if (props.view === "summary") return t("description");

      const ready = isObject(snapshot) && snapshot.status === "ready";
      const writable = ready && snapshot.writable !== false;
      const saving = feedback.phase === "saving";
      const disabled = !writable || saving;
      const errors = ready ? validateDraft(draft) : {};
      const hasErrors = Object.keys(errors).length > 0;
      const ops = ready ? buildOps(draft, snapshot) : [];
      const resetOps = ready ? buildResetOps(snapshot) : [];

      /** @param {string} key - the field to edit. @returns {(event: object) => void} change handler. */
      const edit = (key) => (event) => {
        const target = isObject(event) && isObject(event.target) ? event.target : {};
        const value = asText(target.value);
        setDraft((previous) => ({ ...previous, [key]: value }));
        setFeedback({ phase: "idle" });
      };

      /**
       * Send one atomic mutation and fold its settlement into the local feedback.
       *
       * @param {{ op: "set" | "unset", path: string[], value?: unknown }[]} mutationOps - operations.
       * @param {string} doneLabel - message shown after acceptance.
       * @returns {Promise<void>} settlement.
       */
      const runMutation = async (mutationOps, doneLabel) => {
        if (form === undefined || typeof form.mutate !== "function") {
          setFeedback({ phase: "error", message: t("saveFailed") });
          return;
        }
        if (mutationOps.length === 0) return;
        setFeedback({ phase: "saving" });
        try {
          const accepted = await form.mutate(mutationOps, isObject(snapshot) ? snapshot.revision : undefined);
          if (accepted === false) {
            setFeedback({ phase: "error", message: t("saveFailed") });
            return;
          }
          setFeedback({ phase: "saved", message: doneLabel });
          // A row config change reloads the host side; refresh detection too.
          setDetectNonce((nonce) => nonce + 1);
        } catch (error) {
          setFeedback({ phase: "error", message: errorText(error) });
        }
      };

      const sections = [renderStatus(t, detection, () => setDetectNonce((nonce) => nonce + 1))];

      if (!ready) {
        const loadingOrUnavailable = isObject(snapshot) && snapshot.status === "unavailable" ? t("unavailable") : t("loading");
        sections.push(h("p", { className: "gitbash-win-banner", role: "status", style: STYLES.banner }, loadingOrUnavailable));
      } else {
        if (snapshot.writable === false) {
          sections.push(h("p", { className: "gitbash-win-banner", role: "status", style: STYLES.banner }, t("readOnly")));
        }
        const resolvedPlaceholder = detection.phase === "ready" && isObject(detection.data) && isObject(detection.data.bashPath) && typeof detection.data.bashPath.resolved === "string"
          ? detection.data.bashPath.resolved
          : "";
        const inputBase = { disabled, spellCheck: false, autoComplete: "off" };
        sections.push(
          h(
            "div",
            { className: "gitbash-win-fields", style: STYLES.column },
            heading(t("fieldsHeading")),
            fieldElement(t("bashPath"), "gitbash-win-bashPath", t("bashPathHint"), {
              ...inputBase,
              type: "text",
              value: draft.bashPath,
              placeholder: resolvedPlaceholder !== "" ? resolvedPlaceholder : t("bashPathPlaceholder"),
              "aria-invalid": errors.bashPath === true ? true : undefined,
              onChange: edit("bashPath"),
            }),
            fieldElement(t("initScript"), "gitbash-win-initScript", t("initScriptHint"), {
              ...inputBase,
              type: "text",
              value: draft.initScript,
              placeholder: t("initScriptPlaceholder"),
              onChange: edit("initScript"),
            }),
            fieldElement(t("timeoutMs"), "gitbash-win-timeoutMs", t("timeoutMsHint"), {
              ...inputBase,
              type: "text",
              inputMode: "numeric",
              value: draft.timeoutMs,
              placeholder: NUMBER_PLACEHOLDERS.timeoutMs,
              "aria-invalid": errors.timeoutMs === true ? true : undefined,
              onChange: edit("timeoutMs"),
            }),
            fieldElement(t("maxOutputBytes"), "gitbash-win-maxOutputBytes", t("maxOutputBytesHint"), {
              ...inputBase,
              type: "text",
              inputMode: "numeric",
              value: draft.maxOutputBytes,
              placeholder: NUMBER_PLACEHOLDERS.maxOutputBytes,
              "aria-invalid": errors.maxOutputBytes === true ? true : undefined,
              onChange: edit("maxOutputBytes"),
            }),
            hasErrors ? h("p", { className: "gitbash-win-hint", role: "status", style: STYLES.hint }, t("invalidNumber")) : null,
          ),
        );

        const feedbackLine = feedback.phase === "saved"
          ? h("span", { className: "gitbash-win-saved", role: "status", style: STYLES.saved }, asText(feedback.message) !== "" ? feedback.message : t("saved"))
          : feedback.phase === "error"
            ? h("span", { className: "gitbash-win-error", role: "alert", style: STYLES.error }, asText(feedback.message) !== "" ? feedback.message : t("saveFailed"))
            : feedback.phase === "saving"
              ? h("span", { className: "gitbash-win-hint", role: "status", style: STYLES.hint }, t("saving"))
              : null;
        sections.push(
          h(
            "div",
            { className: "gitbash-win-actions", style: STYLES.footer },
            h(
              "button",
              {
                type: "button",
                id: "gitbash-win-save",
                className: "gitbash-win-button gitbash-win-save",
                disabled: disabled || hasErrors || ops.length === 0,
                "aria-busy": saving || undefined,
                onClick: () => {
                  void runMutation(buildOps(draft, snapshot), t("saved"));
                },
              },
              t("save"),
            ),
            h(
              "button",
              {
                type: "button",
                id: "gitbash-win-reset",
                className: "gitbash-win-button gitbash-win-reset",
                disabled: disabled || resetOps.length === 0,
                onClick: () => {
                  void runMutation(buildResetOps(snapshot), t("resetDone"));
                },
              },
              t("resetToDefault"),
            ),
            feedbackLine,
          ),
        );
      }

      return h(
        "div",
        { className: "gitbash-win-card", "data-plugin": "dsh-gitbash-win", style: STYLES.card },
        ...sections.filter((section) => section !== null && section !== undefined && section !== false),
      );
    }

    // ---------------------------------------------------------------------
    // Plugin entry.
    // ---------------------------------------------------------------------

    /**
     * Mount the Git Bash settings page while the Host serves its namespace.
     *
     * @param {object} ctx - the browser plugin context.
     * @returns {void}
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { en, ja }), "gitbash-win: dictionaries");

      const form = ctx.configForms.get(CONFIG_NS);
      const api = Object.freeze({ statusPath: STATUS_PATH, configNamespace: CONFIG_NS });

      ctx.effect(
        () =>
          ctx.configForms.whileServed([CONFIG_NS], () =>
            ctx.slots.inject("plugins.item", () =>
              ctx.slots.register(
                {
                  name: "plugins.item",
                  id: "gitbash-win",
                  order: 50,
                  label: () => t("title"),
                  locale: NS,
                  inject: () => ({
                    hooks: { configForm: form },
                    configForm: form,
                    form,
                    api,
                  }),
                },
                Card,
              ),
            ),
          ),
        "gitbash-win: page",
      );
    }

    exports.NS = NS;
    exports.CONFIG_NS = CONFIG_NS;
    exports.STATUS_PATH = STATUS_PATH;
    exports.inject = ["slots", "configForms", "locale"];
    exports.locales = { en, ja };
    exports.Card = Card;
    exports.apply = apply;
    exports.__internals = Object.freeze({
      FIELDS,
      NUMBER_PLACEHOLDERS,
      buildOps,
      buildResetOps,
      draftFromSnapshot,
      validateDraft,
      parseNumberText,
      requestStatus,
      sourceKey,
      errorText,
      hasUserField,
    });

    return module.exports;
  },
});
