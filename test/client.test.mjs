/**
 * Harness tests for the browser half (lib/client.js).
 *
 * Runs on plain Node without a browser or network: the classic-script loader is
 * stubbed through node:vm, React is replaced by a tiny createElement + hooks
 * stand-in, and fetch is a local stub. Nothing here touches ~/.dsh or a live
 * DSH service.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_PATH = join(PROJECT_ROOT, "lib", "client.js");
const EN_LOCALE_PATH = join(PROJECT_ROOT, "locale", "en.json");
const JA_LOCALE_PATH = join(PROJECT_ROOT, "locale", "ja.json");
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, "utf8");

/** Convert a vm-realm JSON-shaped value into this realm for strict assertions. */
const host = (value) => JSON.parse(JSON.stringify(value));

const STATUS_JSON = {
  plugin: "dsh-gitbash-win",
  platform: "win32",
  supported: true,
  bashPath: {
    configured: "",
    resolved: "C:/Program Files/Git/bin/bash.exe",
    ok: true,
    source: "known-dir",
    candidates: [
      { path: "C:/Program Files/Git/bin/bash.exe", ok: true, reason: null },
      { path: "C:/Windows/System32/bash.exe", ok: false, reason: "WSL alias rejected" },
    ],
  },
  sandbox: { available: true, defaultMode: "workspace-write", fallback: "fail" },
  tool: { name: "bash", global: true },
};

// ---------------------------------------------------------------------------
// Tiny React stand-in: createElement plus the hooks the card calls.
// ---------------------------------------------------------------------------

function createReactHarness() {
  let hooks = [];
  let hookIndex = 0;
  let pendingEffects = [];
  let dirty = false;
  let mounted = null;
  let lastElement = null;

  const react = {
    createElement(type, props, ...children) {
      const normalized = {};
      if (props !== null && props !== undefined) {
        for (const key of Object.keys(props)) normalized[key] = props[key];
      }
      if (children.length === 1) normalized.children = children[0];
      else if (children.length > 1) normalized.children = children;
      return { type, props: normalized };
    },
    useState(initial) {
      const index = hookIndex;
      hookIndex += 1;
      if (hooks[index] === undefined) {
        hooks[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
      }
      const slot = hooks[index];
      const set = (next) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
      };
      return [slot.value, set];
    },
    useRef(initial) {
      const index = hookIndex;
      hookIndex += 1;
      if (hooks[index] === undefined) hooks[index] = { kind: "ref", value: { current: initial } };
      return hooks[index].value;
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callback) {
      return callback;
    },
    useEffect(effect, dependencies) {
      const index = hookIndex;
      hookIndex += 1;
      if (hooks[index] === undefined) {
        hooks[index] = { kind: "effect", deps: undefined, cleanup: undefined };
      }
      const slot = hooks[index];
      const previous = slot.deps;
      const changed =
        previous === undefined ||
        dependencies === undefined ||
        dependencies.length !== previous.length ||
        dependencies.some((dependency, position) => !Object.is(dependency, previous[position]));
      if (changed) {
        slot.deps = dependencies === undefined ? undefined : dependencies.slice();
        pendingEffects.push({ slot, effect });
      }
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };

  function renderCurrent() {
    hookIndex = 0;
    pendingEffects = [];
    lastElement = mounted.component(mounted.props);
    return lastElement;
  }

  function runPendingEffects() {
    const batch = pendingEffects;
    pendingEffects = [];
    for (const entry of batch) {
      if (typeof entry.slot.cleanup === "function") entry.slot.cleanup();
      const cleanup = entry.effect();
      entry.slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
    dirty = true;
  }

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function settle({ rounds = 80 } = {}) {
    for (let round = 0; round < rounds; round += 1) {
      if (mounted === null) return lastElement;
      if (pendingEffects.length > 0) {
        runPendingEffects();
        continue;
      }
      await flush();
      if (!dirty) return lastElement;
      dirty = false;
      renderCurrent();
    }
    throw new Error("component did not settle");
  }

  function unmount() {
    for (const slot of hooks) {
      if (slot !== undefined && slot.kind === "effect" && typeof slot.cleanup === "function") slot.cleanup();
    }
    mounted = null;
    pendingEffects = [];
  }

  function rerender(nextProps) {
    mounted = { ...mounted, props: nextProps === undefined ? mounted.props : nextProps };
    dirty = true;
    renderCurrent();
  }

  return {
    react,
    mount(component, props) {
      mounted = { component, props };
      hooks = [];
      dirty = false;
      renderCurrent();
      return { element: lastElement, settle, unmount, rerender };
    },
  };
}

// ---------------------------------------------------------------------------
// Element tree helpers (host-realm plain objects produced by the stub).
// ---------------------------------------------------------------------------

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node === "string" || typeof node === "number") {
    visit(node);
    return;
  }
  if (typeof node === "object") {
    visit(node);
    walk(node.props === undefined ? undefined : node.props.children, visit);
  }
}

/** @returns {object[]} every element node matching the predicate. */
function collect(element, predicate) {
  const found = [];
  walk(element, (node) => {
    if (typeof node === "object" && node !== null && predicate(node)) found.push(node);
  });
  return found;
}

function textContent(element) {
  const parts = [];
  walk(element, (node) => {
    if (typeof node === "string" || typeof node === "number") parts.push(String(node));
  });
  return parts.join(" ");
}

function byId(element, id) {
  return collect(element, (node) => node.props !== undefined && node.props.id === id)[0];
}

function byType(element, type) {
  return collect(element, (node) => node.type === type);
}

// ---------------------------------------------------------------------------
// Fake browser environment / fake DSH services.
// ---------------------------------------------------------------------------

/**
 * Evaluate lib/client.js as a classic script with a stubbed window loader and
 * return the registered module plus the environment used to exercise it.
 */
function loadClient() {
  const definitions = [];
  const sandbox = {
    console,
    fetch: undefined,
    window: {
      __ModuleLoader__: {
        load(definition) {
          definitions.push(definition);
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SOURCE, sandbox, { filename: CLIENT_PATH });
  assert.equal(definitions.length, 1, "lib/client.js must register exactly one module");
  const definition = definitions[0];
  const harness = createReactHarness();
  const requires = [];
  const client = definition.factory((specifier) => {
    requires.push(specifier);
    if (specifier === "react") return harness.react;
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
  });
  return { definition, client, sandbox, harness, requires };
}

/** A locale reader over one embedded dictionary, with parameter substitution. */
function makeT(locales, locale = "ja") {
  const dictionary = locales[locale];
  const calls = [];
  const t = (key, params) => {
    calls.push({ key, params });
    const template = dictionary[key] ?? key;
    if (params === undefined || params === null) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
  };
  t.calls = calls;
  return t;
}

/** Build a config-form snapshot as the ConfigFormController would expose it. */
function snapshotReady({ writable = true, value = {}, user = undefined, revision = 7 } = {}) {
  const base = { bashPath: "", initScript: "", timeoutMs: 120000, maxOutputBytes: 64000, sandboxFallback: "fail" };
  return {
    status: "ready",
    value: { ...base, ...value },
    base: { ...base },
    user,
    revision,
    writable,
  };
}

/** A minimal ConfigFormController fake: one shared write queue, no host calls. */
function makeForm(snapshot) {
  const mutateCalls = [];
  const listeners = new Set();
  let current = snapshot;
  const form = {
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mutate(ops, revision) {
      mutateCalls.push({ ops, revision });
      return true;
    },
  };
  return {
    form,
    mutateCalls,
    publish(next) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** A fetch stub recording every call and answering with `payload`. */
function makeFetchStub(payload = STATUS_JSON) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetch, calls };
}

/** Props the plugins.item slot hands to the card for the page view. */
function pageProps(t, form, client) {
  return {
    view: "page",
    t,
    api: { statusPath: client.STATUS_PATH, configNamespace: client.CONFIG_NS },
    configForm: form,
    useConfigForm: (selector) => selector(form.getSnapshot()),
  };
}

// ---------------------------------------------------------------------------
// Module shape / classic script.
// ---------------------------------------------------------------------------

test("client half is a classic script with the expected plugin exports", () => {
  const { definition, client, requires } = loadClient();
  assert.equal(definition.id, "dsh-gitbash-win");
  assert.equal(typeof definition.factory, "function");
  assert.deepEqual(host(client.inject), ["slots", "configForms", "locale"]);
  assert.equal(typeof client.apply, "function");
  assert.equal(client.NS, "settings.gitbash-win");
  assert.equal(client.CONFIG_NS, "gitbash-win");
  assert.equal(client.STATUS_PATH, "/dsh-gitbash-win/status");
  assert.equal(typeof client.Card, "function");
  assert.deepEqual(host(client.__internals.FIELDS.map((field) => field.key)), [
    "bashPath",
    "initScript",
    "timeoutMs",
    "maxOutputBytes",
  ]);
  assert.deepEqual(requires, ["react"]);
  assert.ok(CLIENT_SOURCE.includes("window.__ModuleLoader__.load("));
  assert.doesNotMatch(CLIENT_SOURCE, /(^|\n)\s*export\s+(default|const|function|\{)/);
  assert.doesNotMatch(CLIENT_SOURCE, /(^|\n)\s*import\s/);
});

test("apply registers the Git Bash card only while the namespace is served", () => {
  const { client } = loadClient();
  const effects = [];
  const registered = [];
  const injectedSlots = [];
  const whileServed = [];
  const formsRequested = [];
  const boundNamespaces = [];
  const registeredLocales = [];
  const fakeForm = {
    getSnapshot: () => ({ status: "loading", writable: false }),
    subscribe: () => () => {},
    mutate: async () => true,
  };
  const dictionary = client.locales.ja;
  const ctx = {
    locale: {
      bind(namespace) {
        boundNamespaces.push(namespace);
        return (key) => dictionary[key] ?? key;
      },
      register(namespace, dictionaries) {
        registeredLocales.push({ namespace, dictionaries });
        return () => {};
      },
    },
    configForms: {
      get(namespace) {
        formsRequested.push(namespace);
        return fakeForm;
      },
      whileServed(namespaces, callback) {
        whileServed.push(namespaces.slice());
        return callback(new Set(namespaces));
      },
    },
    slots: {
      inject(name, callback) {
        injectedSlots.push(name);
        return callback();
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {};
      },
    },
    effect(callback, label) {
      effects.push({ label, disposer: callback() });
      return () => {};
    },
  };

  client.apply(ctx);

  assert.deepEqual(host(boundNamespaces), ["settings.gitbash-win"]);
  assert.equal(registeredLocales.length, 1);
  assert.equal(registeredLocales[0].namespace, "settings.gitbash-win");
  assert.equal(registeredLocales[0].dictionaries.en, client.locales.en);
  assert.equal(registeredLocales[0].dictionaries.ja, client.locales.ja);
  assert.deepEqual(host(formsRequested), ["gitbash-win"]);
  assert.deepEqual(host(whileServed), [["gitbash-win"]]);
  assert.deepEqual(host(injectedSlots), ["plugins.item"]);
  assert.deepEqual(
    effects.map((effect) => effect.label),
    ["gitbash-win: dictionaries", "gitbash-win: page"],
  );
  assert.equal(registered.length, 1);

  const { options, component } = registered[0];
  assert.equal(options.name, "plugins.item");
  assert.equal(options.id, "gitbash-win");
  assert.equal(options.order, 50);
  assert.equal(options.locale, "settings.gitbash-win");
  assert.equal(typeof options.label, "function");
  assert.equal(options.label(), "Git Bash");
  assert.equal(typeof options.inject, "function");
  const face = options.inject();
  assert.equal(face.configForm, fakeForm);
  assert.equal(face.form, fakeForm);
  assert.equal(face.hooks.configForm, fakeForm);
  assert.equal(face.api.statusPath, "/dsh-gitbash-win/status");
  assert.equal(face.api.configNamespace, "gitbash-win");
  assert.equal(component, client.Card);
});

// ---------------------------------------------------------------------------
// Locale dictionaries.
// ---------------------------------------------------------------------------

test("locale dictionaries are key-identical and match locale/*.json", () => {
  const { client } = loadClient();
  const en = client.locales.en;
  const ja = client.locales.ja;
  const enKeys = Object.keys(en).sort();
  const jaKeys = Object.keys(ja).sort();
  assert.deepEqual(host(jaKeys), host(enKeys));
  assert.ok(enKeys.length >= 40, "the card should carry a complete dictionary");
  for (const key of enKeys) {
    assert.equal(typeof en[key], "string", `en.${key} must be a string`);
    assert.equal(typeof ja[key], "string", `ja.${key} must be a string`);
    assert.notEqual(en[key].trim(), "", `en.${key} must not be empty`);
    assert.notEqual(ja[key].trim(), "", `ja.${key} must not be empty`);
  }
  assert.deepEqual(host(en), JSON.parse(readFileSync(EN_LOCALE_PATH, "utf8")));
  assert.deepEqual(host(ja), JSON.parse(readFileSync(JA_LOCALE_PATH, "utf8")));
});

test("every dictionary key used by the card exists in both locales", () => {
  const { client } = loadClient();
  const used = new Set();
  for (const match of CLIENT_SOURCE.matchAll(/\bt\("([A-Za-z][A-Za-z0-9]*)"\)/g)) used.add(match[1]);
  for (const match of CLIENT_SOURCE.matchAll(/\bt\("([A-Za-z][A-Za-z0-9]*)",/g)) used.add(match[1]);
  assert.ok(used.size >= 35, `expected many dictionary keys, found ${used.size}`);
  for (const key of used) {
    assert.ok(Object.hasOwn(client.locales.en, key), `missing en key: ${key}`);
    assert.ok(Object.hasOwn(client.locales.ja, key), `missing ja key: ${key}`);
  }
  // Source ids are translated through sourceKey() at render time.
  for (const source of ["configured", "known-dir", "path", "git-sibling", "registry", "unknown"]) {
    const key = client.__internals.sourceKey(source);
    assert.ok(Object.hasOwn(client.locales.en, key), `missing en key for source ${source}`);
    assert.ok(Object.hasOwn(client.locales.ja, key), `missing ja key for source ${source}`);
  }
  assert.equal(client.__internals.sourceKey("unknown"), "sourceUnknown");
  assert.equal(client.__internals.sourceKey(undefined), "sourceUnknown");
});

// ---------------------------------------------------------------------------
// Pure ops builder.
// ---------------------------------------------------------------------------

test("buildOps only emits set/unset ops for changed editable fields", () => {
  const { client } = loadClient();
  const { buildOps, buildResetOps, draftFromSnapshot, validateDraft } = client.__internals;
  const snapshot = snapshotReady();
  const baseDraft = draftFromSnapshot(snapshot);

  assert.deepEqual(host(baseDraft), { bashPath: "", initScript: "", timeoutMs: "120000", maxOutputBytes: "64000" });
  assert.deepEqual(host(buildOps(baseDraft, snapshot)), []);

  assert.deepEqual(host(buildOps({ ...baseDraft, bashPath: "  C:/Program Files/Git/bin/bash.exe  " }, snapshot)), [
    // Non-empty text keeps the exact user-typed value (no silent trim).
    { op: "set", path: ["bashPath"], value: "  C:/Program Files/Git/bin/bash.exe  " },
  ]);
  assert.deepEqual(host(buildOps({ ...baseDraft, timeoutMs: "60000" }, snapshot)), [
    { op: "set", path: ["timeoutMs"], value: 60000 },
  ]);
  assert.deepEqual(host(buildOps({ ...baseDraft, initScript: "~/.dsh/gitbash-init.sh", maxOutputBytes: "128000" }, snapshot)), [
    { op: "set", path: ["initScript"], value: "~/.dsh/gitbash-init.sh" },
    { op: "set", path: ["maxOutputBytes"], value: 128000 },
  ]);

  // Clearing a field releases the user override; without an override it is a no-op.
  const overridden = snapshotReady({
    value: { bashPath: "C:/custom/bash.exe", timeoutMs: 60000 },
    user: { bashPath: "C:/custom/bash.exe", timeoutMs: 60000 },
  });
  const cleared = { bashPath: "", initScript: "", timeoutMs: "", maxOutputBytes: "" };
  assert.deepEqual(host(buildOps(cleared, overridden)), [
    { op: "unset", path: ["bashPath"] },
    { op: "unset", path: ["timeoutMs"] },
  ]);
  assert.deepEqual(host(buildOps({ ...baseDraft, timeoutMs: "", maxOutputBytes: "" }, snapshot)), []);
  assert.deepEqual(host(buildOps({ ...baseDraft, timeoutMs: "120000" }, snapshotReady({ value: { timeoutMs: 120000 }, user: { timeoutMs: 120000 } }))), []);
  // Whitespace-only text clears rather than setting blank text.
  assert.deepEqual(host(buildOps({ ...cleared, bashPath: "   " }, overridden)), [
    { op: "unset", path: ["bashPath"] },
    { op: "unset", path: ["timeoutMs"] },
  ]);

  // Invalid numeric text is never sent; the UI blocks Save instead.
  assert.deepEqual(host(buildOps({ ...baseDraft, timeoutMs: "abc" }, snapshot)), []);
  assert.deepEqual(host(validateDraft({ ...baseDraft, timeoutMs: "abc" })), { timeoutMs: true });
  assert.deepEqual(host(validateDraft({ ...baseDraft, timeoutMs: "" })), {});
  assert.deepEqual(host(validateDraft({ ...baseDraft, maxOutputBytes: "-1" })), { maxOutputBytes: true });

  // sandboxFallback is never part of a save or reset, even when overridden.
  const fallbackOverridden = snapshotReady({
    value: { sandboxFallback: "unconfined", timeoutMs: 5000 },
    user: { sandboxFallback: "unconfined", timeoutMs: 5000 },
  });
  assert.deepEqual(host(buildResetOps(fallbackOverridden)), [{ op: "unset", path: ["timeoutMs"] }]);
  const ops = buildOps({ ...cleared }, fallbackOverridden);
  assert.ok(ops.every((op) => !op.path.includes("sandboxFallback")));
});

test("number placeholders match the canonical executor-schema defaults", async () => {
  const { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES } = await import("../lib/schema.js")
  const { client } = loadClient()
  assert.equal(client.__internals.NUMBER_PLACEHOLDERS.timeoutMs, String(DEFAULT_TIMEOUT_MS))
  assert.equal(client.__internals.NUMBER_PLACEHOLDERS.maxOutputBytes, String(DEFAULT_MAX_OUTPUT_BYTES))
})

test("buildResetOps releases only the card's own overrides", () => {
  const { client } = loadClient();
  const { buildResetOps } = client.__internals;
  assert.deepEqual(host(buildResetOps(snapshotReady())), []);
  assert.deepEqual(
    host(
      buildResetOps(
        snapshotReady({ value: { bashPath: "C:/x/bash.exe", maxOutputBytes: 1 }, user: { bashPath: "C:/x/bash.exe", maxOutputBytes: 1 } }),
      ),
    ),
    [
      { op: "unset", path: ["bashPath"] },
      { op: "unset", path: ["maxOutputBytes"] },
    ],
  );
});

test("requestStatus GETs the detection route with same-origin credentials only", async () => {
  const { client, sandbox } = loadClient();
  const { requestStatus } = client.__internals;
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => STATUS_JSON };
  };

  const result = await requestStatus(fetchStub);
  assert.deepEqual(result, STATUS_JSON);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/dsh-gitbash-win/status");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(host(calls[0].options.headers), { accept: "application/json" });
  assert.equal(calls[0].options.body, undefined);

  // The browser global fetch is used when no override is passed.
  sandbox.fetch = fetchStub;
  const viaGlobal = await requestStatus();
  assert.deepEqual(viaGlobal, STATUS_JSON);
  assert.equal(calls.length, 2);

  await assert.rejects(() => requestStatus(async () => ({ ok: false, status: 503, json: async () => ({}) })), /HTTP 503/);
  await assert.rejects(() => requestStatus(async () => ({ ok: true, status: 200, json: async () => [1, 2] })), /JSON object/);
  sandbox.fetch = undefined;
  await assert.rejects(() => requestStatus(), /fetch\(\) is not available/);
});

// ---------------------------------------------------------------------------
// Card rendering (summary + page).
// ---------------------------------------------------------------------------

test("summary view returns the description and never calls the status route", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const { form } = makeForm(snapshotReady());
  const view = harness.mount(client.Card, {
    view: "summary",
    t,
    api: { statusPath: client.STATUS_PATH },
    configForm: form,
    useConfigForm: (selector) => selector(form.getSnapshot()),
  });
  const settled = await view.settle();
  assert.equal(settled, client.locales.ja.description);
  assert.equal(fetchStub.calls.length, 0);
  view.unmount();
});

test("page view renders the detection report and exactly the four editable fields", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const { form } = makeForm(snapshotReady());
  const view = harness.mount(client.Card, pageProps(t, form, client));
  const element = await view.settle();

  assert.equal(fetchStub.calls.length, 1);
  assert.equal(fetchStub.calls[0].url, "/dsh-gitbash-win/status");
  assert.equal(fetchStub.calls[0].options.method, "GET");
  assert.equal(fetchStub.calls[0].options.credentials, "same-origin");

  const text = textContent(element);
  assert.ok(text.includes("C:/Program Files/Git/bin/bash.exe"), "resolved path is shown");
  assert.ok(text.includes(client.locales.ja.sourceKnownDir), "detection source is translated");
  assert.ok(text.includes(client.locales.ja.candidates), "candidate heading is shown");
  assert.ok(text.includes("C:/Windows/System32/bash.exe"), "candidate paths are shown");
  assert.ok(text.includes("WSL alias rejected"), "candidate failure reasons are shown");
  assert.ok(text.includes("workspace-write"), "sandbox.defaultMode is shown");
  assert.ok(text.includes(client.locales.ja.sandboxFallback), "sandboxFallback is shown read-only");
  assert.ok(text.includes(client.locales.ja.sandboxFallbackNote), "the safety note is shown");
  assert.ok(text.includes(client.locales.ja.fieldsHeading));

  const inputs = byType(element, "input");
  assert.equal(inputs.length, 4, "only bashPath/initScript/timeoutMs/maxOutputBytes are inputs");
  assert.deepEqual(
    inputs.map((input) => input.props.id).sort((left, right) => left.localeCompare(right)),
    ["gitbash-win-bashPath", "gitbash-win-initScript", "gitbash-win-maxOutputBytes", "gitbash-win-timeoutMs"],
  );
  const bashPathInput = byId(element, "gitbash-win-bashPath");
  assert.equal(bashPathInput.props.value, "");
  assert.equal(bashPathInput.props.placeholder, "C:/Program Files/Git/bin/bash.exe");
  assert.equal(byId(element, "gitbash-win-initScript").props.value, "");
  assert.equal(byId(element, "gitbash-win-timeoutMs").props.value, "120000");
  assert.equal(byId(element, "gitbash-win-maxOutputBytes").props.value, "64000");
  for (const input of inputs) {
    assert.ok(!/fallback/i.test(String(input.props.id)), "sandboxFallback must not be an input");
    assert.notEqual(String(input.props.value), "fail");
    assert.notEqual(String(input.props.value), "unconfined");
    assert.equal(input.props.disabled, false);
  }
  assert.equal(byId(element, "gitbash-win-save").props.disabled, true, "Save is idle with no changes");
  assert.equal(byId(element, "gitbash-win-reset").props.disabled, true, "Reset is idle without overrides");
  view.unmount();
});

test("the re-detect button refetches the status route", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const { form } = makeForm(snapshotReady());
  const view = harness.mount(client.Card, pageProps(t, form, client));
  let element = await view.settle();
  assert.equal(fetchStub.calls.length, 1);
  byId(element, "gitbash-win-redetect").props.onClick();
  element = await view.settle();
  assert.equal(fetchStub.calls.length, 2);
  assert.equal(fetchStub.calls[1].url, "/dsh-gitbash-win/status");
  view.unmount();
});

test("Save sends one atomic mutate with set ops for changed fields", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm(snapshotReady());
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  let element = await view.settle();

  byId(element, "gitbash-win-timeoutMs").props.onChange({ target: { value: "60000" } });
  element = await view.settle();
  assert.equal(byId(element, "gitbash-win-save").props.disabled, false);

  byId(element, "gitbash-win-save").props.onClick();
  element = await view.settle();

  assert.equal(state.mutateCalls.length, 1);
  assert.deepEqual(host(state.mutateCalls[0].ops), [{ op: "set", path: ["timeoutMs"], value: 60000 }]);
  assert.equal(state.mutateCalls[0].revision, 7);
  assert.ok(textContent(element).includes(client.locales.ja.saved));
  assert.equal(fetchStub.calls.length, 2, "detection is refreshed after an accepted save");
  view.unmount();
});

test("clearing overridden fields sends unset ops in the same mutate", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm(
    snapshotReady({
      value: { bashPath: "C:/custom/bash.exe", timeoutMs: 60000 },
      user: { bashPath: "C:/custom/bash.exe", timeoutMs: 60000 },
    }),
  );
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  let element = await view.settle();
  byId(element, "gitbash-win-bashPath").props.onChange({ target: { value: "" } });
  element = await view.settle();
  byId(element, "gitbash-win-timeoutMs").props.onChange({ target: { value: "" } });
  element = await view.settle();
  byId(element, "gitbash-win-save").props.onClick();
  await view.settle();
  assert.equal(state.mutateCalls.length, 1);
  assert.deepEqual(host(state.mutateCalls[0].ops), [
    { op: "unset", path: ["bashPath"] },
    { op: "unset", path: ["timeoutMs"] },
  ]);
  view.unmount();
});

test("Reset to default unsets only overridden fields", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm(
    snapshotReady({
      value: { bashPath: "C:/custom/bash.exe", timeoutMs: 60000 },
      user: { bashPath: "C:/custom/bash.exe", timeoutMs: 60000 },
    }),
  );
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  const element = await view.settle();
  const reset = byId(element, "gitbash-win-reset");
  assert.equal(reset.props.disabled, false);
  reset.props.onClick();
  await view.settle();
  assert.deepEqual(host(state.mutateCalls[0].ops), [
    { op: "unset", path: ["bashPath"] },
    { op: "unset", path: ["timeoutMs"] },
  ]);
  view.unmount();
});

test("invalid numeric input blocks Save and explains why", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm(snapshotReady());
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  let element = await view.settle();
  byId(element, "gitbash-win-timeoutMs").props.onChange({ target: { value: "abc" } });
  element = await view.settle();
  assert.equal(byId(element, "gitbash-win-timeoutMs").props["aria-invalid"], true);
  assert.equal(byId(element, "gitbash-win-save").props.disabled, true);
  assert.ok(textContent(element).includes(client.locales.ja.invalidNumber));
  view.unmount();
});

test("read-only deployments disable editing and show the read-only banner", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm(snapshotReady({ writable: false }));
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  const element = await view.settle();
  assert.ok(textContent(element).includes(client.locales.ja.readOnly));
  for (const input of byType(element, "input")) assert.equal(input.props.disabled, true);
  assert.equal(byId(element, "gitbash-win-save").props.disabled, true);
  view.unmount();
});

test("loading snapshots show the loading banner instead of a form", async () => {
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub();
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm({ status: "loading", value: undefined, base: undefined, user: undefined, revision: undefined, writable: false });
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  const element = await view.settle();
  const text = textContent(element);
  assert.ok(text.includes(client.locales.ja.loading));
  assert.equal(byType(element, "input").length, 0);
  assert.equal(byId(element, "gitbash-win-save"), undefined);
  view.unmount();
});

test("status route failures render gracefully", async () => {
  const { client, harness, sandbox } = loadClient();
  sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
  const t = makeT(client.locales, "ja");
  const state = makeForm(snapshotReady());
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  const element = await view.settle();
  const text = textContent(element);
  assert.ok(text.includes(client.locales.ja.detectFailed));
  assert.ok(text.includes("HTTP 500"));
  assert.ok(byId(element, "gitbash-win-save") !== undefined, "the form still renders when detection fails");
  view.unmount();
});

test("unsupported platforms and missing sandbox mode are reported", async () => {
  const payload = {
    ...STATUS_JSON,
    platform: "linux",
    supported: false,
    bashPath: { configured: "", resolved: null, ok: false, source: "path", candidates: [] },
    sandbox: { available: false, defaultMode: null, fallback: "fail" },
  };
  const { client, harness, sandbox } = loadClient();
  const fetchStub = makeFetchStub(payload);
  sandbox.fetch = fetchStub.fetch;
  const t = makeT(client.locales, "ja");
  const state = makeForm(snapshotReady());
  const view = harness.mount(client.Card, pageProps(t, state.form, client));
  const element = await view.settle();
  const text = textContent(element);
  assert.ok(text.includes("linux"));
  assert.ok(text.includes("Windows 専用"));
  assert.ok(text.includes(client.locales.ja.sandboxUnavailable));
  assert.ok(text.includes(client.locales.ja.notDetected));
  view.unmount();
});
