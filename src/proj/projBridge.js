/*
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

class WorkerBridge {
    static current_script_url = typeof document !== 'undefined' ? document.currentScript.src : ''; // just for browser

    constructor(worker_path) {
        this.pending_requests = new Map();
        this.next_correlation_id = 1;
        const is_node = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

        if (is_node) {
            // Node.js Worker Setup
            worker_path = worker_path ?? `${__dirname}/projWorker.js`;
            const { Worker } = require('node:worker_threads');
            this.worker = new Worker(worker_path);
            this.worker.on('message', (data) => this._handle_message({ data }));
        } else {
            // Browser Web Worker Setup
            worker_path = worker_path ?? new URL('./projWorker.js', WorkerBridge.current_script_url);
            this.worker = new globalThis.Worker(worker_path);
            this.worker.onmessage = (e) => this._handle_message(e);
        }
    }

    create_main_proxy() {
        return this.create_proxy('root');
    }

    /**
     * Creates a Proxy that acts as the remote object.
     * @param {string} object_id
     * @param {number} default_timeout_ms
     */
    create_proxy(object_id, default_timeout_ms = 30000) {
        // The handler intercepts property access (method calls)
        const handler = {
            get: (_target, prop) => {
                // Intercept a special property to reveal the object_id
                if (prop === '__object_id') return object_id;

                // If we try to await the proxy itself, ignore .then
                if (prop === 'then') return undefined;

                // Return a function that sends the request
                return (...args) => {
                    return this.execute(object_id, prop, args, default_timeout_ms);
                };
            },
        };
        return new Proxy({}, handler);
    }

    // Helper to create a proxy with a specific timeout
    with_timeout(proxy, timeout_ms) {
        const id = proxy.__object_id;
        if (!id) {
            throw new Error('Provided object is not a valid Worker Proxy');
        }
        return this.create_proxy(id, timeout_ms);
    }

    execute(object_id, method, args = [], timeout_ms) {
        return new Promise((resolve, reject) => {
            const correlation_id = this.next_correlation_id++;

            const timer = setTimeout(() => {
                if (this.pending_requests.has(correlation_id)) {
                    this.pending_requests.delete(correlation_id);
                    reject(new Error(`Timeout: ${method} exceeded ${timeout_ms}ms`));
                }
            }, timeout_ms);

            this.pending_requests.set(correlation_id, {
                resolve,
                reject,
                timer,
            });

            this.worker.postMessage({
                correlation_id,
                object_id,
                method,
                args,
            });
        });
    }

    get_status(timeout_ms = 2000) {
        // We route this to the special 'system' ID we just set up
        return this.execute('system', 'get_status', [], timeout_ms);
    }

    close() {
        // 1. Terminate the actual worker thread immediately
        this.worker.terminate();

        // 2. Reject any pending promises so they don't hang forever
        for (const [_id, request] of this.pending_requests.entries()) {
            clearTimeout(request.timer);
            request.reject(new Error('Worker was terminated.'));
        }

        // 3. Clear the map
        this.pending_requests.clear();
        console.log('Worker connection closed.');
    }

    _handle_message(event) {
        const { correlation_id, status, result, error } = event.data;

        const request = this.pending_requests.get(correlation_id);
        if (!request) return;

        const { resolve, reject, timer } = request;
        clearTimeout(timer);
        this.pending_requests.delete(correlation_id);

        if (status === 'error') {
            reject(new Error(error));
        } else {
            if (result && result.__type === 'REF') {
                // Automatically wrap the result in a Proxy!
                const proxy = this.create_proxy(result.object_id);
                resolve(proxy);
            } else {
                resolve(result);
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WorkerBridge };
}
