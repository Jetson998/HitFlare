import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { create } from "zustand";

const source = await readFile(new URL("../src/stores/use-creative-agent-store.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => setImmediate();

async function page() {
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const window = new EventTarget();
    const connections = []; const calls = []; const disposers = [];
    const user = create(() => ({ user: { id: "user-a" } }));
    const thread = { id: "thread-a", userId: "user-a", revision: 1, messages: [], runs: [], draft: { message: "", referenceIds: [], version: 1 } };
    const snapshot = () => structuredClone({ protocolVersion: 1, thread, assets: [] });
    const server = { beforeRequest: async () => {} };
    class EventSource extends EventTarget {
        constructor(url) { super(); this.url = url; this.closed = false; connections.push(this); }
        close() { this.closed = true; }
        emit(type, data = {}) { this.dispatchEvent(Object.assign(new Event(type), { data: JSON.stringify(data) })); }
    }
    class CreativeApiError extends Error {}
    async function creativeRequest(owner, path, method = "GET", body) {
        calls.push({ owner, path, method });
        await server.beforeRequest(path);
        if (path === "threads") return { threads: [{ id: thread.id }], selectedThreadId: thread.id };
        if (path === "config") return { protocolVersion: 1 };
        if (path.endsWith("/draft")) {
            assert.equal(body.version, thread.draft.version);
            thread.draft = { ...body, version: body.version + 1 }; thread.revision++;
        }
        if (path.endsWith("/turns")) {
            assert.equal(body.draftVersion, thread.draft.version);
            thread.messages.push({ content: { type: "message", message: body.message }, role: "user" });
            thread.draft = { message: "", referenceIds: [], version: thread.draft.version + 1 }; thread.revision++;
        }
        return snapshot();
    }
    const context = createContext({ document, window, EventSource, crypto });
    const dependencies = {
        zustand: { create },
        "@/services/api/creative-agent": { CreativeApiError, creativeRequest },
        "./use-user-store": { useUserStore: user },
        "./use-config-store": {
            useConfigStore: create(() => ({ config: { textModel: "test-text-model" } })),
            modelCapabilityOf: () => "text",
            resolveModelRequestConfig: () => ({ apiFormat: "openai", baseUrl: "https://example.test/v1", apiKey: "test-only", model: "test-text-model" }),
        },
    };
    const module = new SourceTextModule(compiled, { context, initializeImportMeta(meta) { meta.hot = { dispose: callback => disposers.push(callback) }; } });
    await module.link(name => {
        const values = dependencies[name];
        return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
    });
    await module.evaluate();
    const store = module.namespace.useCreativeAgentStore;
    return {
        store, user, connections, calls, thread, server,
        visible(value) { document.visibilityState = value ? "visible" : "hidden"; document.dispatchEvent(new Event("visibilitychange")); },
        navigate(type) { window.dispatchEvent(new Event(type)); },
        dispose() { disposers.forEach(dispose => dispose()); },
        open() { store.getState().open(); return store.getState().watch(user.getState().user.id); },
        active() { return connections.filter(connection => !connection.closed).length; },
    };
}

test("background tabs and closed panels leave connections available for ordinary requests", async () => {
    const pages = await Promise.all(Array.from({ length: 8 }, page));
    try {
        for (const p of pages) { p.visible(false); p.open(); }
        await settle();
        assert.equal(pages.reduce((count, p) => count + p.active(), 0), 0);
        assert.ok(pages.every(p => p.calls.length === 0));
        for (const p of pages) {
            pages.forEach(other => other.visible(other === p));
            await settle();
            assert.equal(pages.reduce((count, other) => count + other.active(), 0), 1);
        }
        const p = pages.at(-1);
        p.store.getState().updateDraft("thread-a", { message: "A summer product poster" });
        await p.store.getState().send("thread-a");
        assert.equal(p.store.getState().sending["thread-a"], false);
        assert.equal(p.store.getState().drafts["thread-a"].message, "");
        assert.equal(p.thread.messages.length, 1);
    } finally { pages.forEach(p => p.dispose()); }
});

test("cleanup during initialization cannot reopen a connection; remount and page restore recover snapshots", async () => {
    const p = await page();
    try {
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        p.server.beforeRequest = () => pending;
        const stop = p.open(); stop();
        release(); await settle();
        assert.equal(p.active(), 0);
        p.server.beforeRequest = async () => {};
        const unmount = p.open(); await settle();
        assert.equal(p.active(), 1);
        p.visible(false);
        assert.equal(p.active(), 0);
        p.thread.messages.push({ role: "assistant", content: { type: "message", message: "Completed while hidden" } }); p.thread.revision++;
        p.visible(true); await settle();
        p.connections.at(-1).emit("ready"); await settle();
        assert.equal(p.store.getState().snapshots["thread-a"].thread.messages.at(-1).content.message, "Completed while hidden");
        p.navigate("pagehide"); assert.equal(p.active(), 0);
        p.navigate("pageshow"); await settle(); assert.equal(p.active(), 1);
        p.store.getState().close(); unmount();
        p.visible(false); p.visible(true); await settle();
        assert.equal(p.active(), 0);
    } finally { p.dispose(); }
});

test("account change rejects old notifications and hot reload releases its subscriptions", async () => {
    const p = await page();
    try {
        p.open(); await settle();
        const old = p.connections.at(-1);
        p.user.setState({ user: { id: "user-b" } });
        assert.equal(p.active(), 0);
        const count = p.calls.length;
        old.emit("ready"); old.emit("change", { userId: "user-a", threadId: "thread-a" });
        await settle(); assert.equal(p.calls.length, count);
        assert.equal(p.store.getState().owner, "");
        p.thread.userId = "user-b";
        p.open(); await settle(); assert.equal(p.active(), 1);
        p.dispose(); assert.equal(p.active(), 0);
        p.navigate("pageshow"); await settle(); assert.equal(p.active(), 0);
    } finally { p.dispose(); }
});

test("initialization errors are visible and manual retry restores the subscription", async () => {
    const p = await page();
    try {
        p.server.beforeRequest = async () => { throw new Error("Service unavailable"); };
        p.open(); await settle();
        assert.equal(p.store.getState().error, "Service unavailable");
        assert.equal(p.active(), 0);
        p.server.beforeRequest = async () => {};
        p.store.getState().reconnect(); await settle();
        p.connections.at(-1).emit("ready"); await settle();
        assert.equal(p.store.getState().ready, true);
        assert.equal(p.store.getState().error, "");
    } finally { p.dispose(); }
});
