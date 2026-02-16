class WorkerBridge {
    constructor(worker_path = 'projWorker.js') {
        this.worker = new Worker(worker_path);
        this.pending_requests = new Map();

        this.worker.onmessage = (e) => this._handle_message(e);
    }

    /**
     * Creates a Proxy that acts as the remote object.
     * @param {string} object_id 
     * @param {number} default_timeout_ms 
     */
    create_proxy(object_id, default_timeout_ms = 500000) {
        // The handler intercepts property access (method calls)
        const handler = {
            get: (target, prop) => {
                // If we try to await the proxy itself, ignore .then
                if (prop === 'then') return undefined;

                // Return a function that sends the request
                return (...args) => {
                    return this.execute(object_id, prop, args, default_timeout_ms);
                };
            }
        };
        return new Proxy({}, handler);
    }

    /**
     * Helper to create a proxy with a specific temporary timeout
     */
    with_timeout(proxy, timeout_ms) {
        // We assume the proxy was created by this bridge. 
        // We return a NEW proxy pointing to the same ID but with new timeout.
        // (Implementation trick: we can read a hidden symbol or just manually recreate it 
        // if we know the ID, but for this example, I'll allow passing the ID directly 
        // or just wrapping the logic differently).

        // Simpler approach for this example: 
        // We attach the ID to the proxy so we can read it back.
        const id = proxy._object_id;
        return this.create_proxy(id, timeout_ms);
    }

    execute(object_id, method, args = [], timeout_ms) {
        return new Promise((resolve, reject) => {
            const correlation_id = crypto.randomUUID();

            const timer = setTimeout(() => {
                if (this.pending_requests.has(correlation_id)) {
                    this.pending_requests.delete(correlation_id);
                    reject(new Error(`Timeout: ${method} exceeded ${timeout_ms}ms`));
                }
            }, timeout_ms);

            this.pending_requests.set(correlation_id, { resolve, reject, timer });

            this.worker.postMessage({
                correlation_id,
                object_id,
                method,
                args
            });
        });
    }

    get_status(timeout_ms = 200000) {
        // We route this to the special 'system' ID we just set up
        return this.execute('system', 'get_status', [], timeout_ms);
    }

    close() {
        // 1. Terminate the actual worker thread immediately
        this.worker.terminate();

        // 2. Reject any pending promises so they don't hang forever
        for (const [id, request] of this.pending_requests.entries()) {
            clearTimeout(request.timer);
            request.reject(new Error("Worker was terminated."));
        }

        // 3. Clear the map
        this.pending_requests.clear();
        console.log("Worker connection closed.");
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
                // Attach ID to proxy for debugging or referencing
                proxy._object_id = result.object_id;
                resolve(proxy);
            } else {
                resolve(result);
            }
        }
    }
}
