'use strict'

/*
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

const is_node = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

let node_parentPort;
if (is_node) {
    node_parentPort = require('node:worker_threads').parentPort;
}

const g_object_registry = new Map();

async function register_proj(registry) {
    try {
        console.log("initializing Proj in worker")
        if (is_node) {
            const ProjModuleFactory = require("./wasm/projModule.js");
            globalThis.ProjModuleFactory = ProjModuleFactory;
            const functions = require("./projFunctions.js");
            globalThis.Proj = functions.Proj;
        } else {
            importScripts("./wasm/projModule.js");
            importScripts("./projFunctions.js");
        }
        const root = new Proj();
        // 'root' is the main entry point
        registry.set('root', root);
    }
    catch (e) {
        console.error("Error loading projModule and projFunctions in projWorker:\n" + e);
        throw e;
    }
    return true;
}

async function handle_message(payload) {
    const { correlation_id, object_id, method, args } = payload;

    if (object_id === 'system' && method === 'get_status') {
        send_message({
            correlation_id,
            status: 'success',
            result: {
                registry_size: g_object_registry.size,
                active_ids: Array.from(g_object_registry.keys())
            }
        });
        return; // Exit early so it doesn't process further
    }

    try {
        if (g_object_registry.size == 0) {
            await register_proj(g_object_registry);
        }

        const target_object = g_object_registry.get(object_id);

        if (!target_object) {
            throw new Error(`Object ${object_id} not found`);
        }

        if (typeof target_object[method] !== 'function') {
            throw new Error(`Method ${method} not found`);
        }

        const result = await target_object[method](...args);

        if (method === 'dispose') {
            g_object_registry.delete(object_id);
        }

        // Check if the result has funcion dispose
        if (result && typeof result.dispose === 'function') {
            const new_object_id = `disposable_${crypto.randomUUID()}`;
            g_object_registry.set(new_object_id, result);

            send_message({
                correlation_id,
                status: 'success',
                // Return a Reference pointer
                result: { __type: 'REF', object_id: new_object_id }
            });
        } else {
            send_message({
                correlation_id,
                status: 'success',
                result: result
            });
        }

    } catch (error) {
        send_message({
            correlation_id,
            status: 'error',
            error: error.message
        });
    }
};

function send_message(msg) {
    if (is_node) {
        node_parentPort.postMessage(msg);
    } else {
        self.postMessage(msg);
    }
}

try {
    if (is_node) {
        node_parentPort.on('message', handle_message);
    } else {
        self.onmessage = (e) => handle_message(e.data);
    }
} catch (e) {
    console.error("ERROR loading worker:", e);
}
