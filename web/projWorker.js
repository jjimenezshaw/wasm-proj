// worker.js
importScripts('projFunctions.js');

const g_object_registry = new Map();

// 'root' is our entry point

async function register_proj(registry) {
    // initialize the first time:
    console.log("initializing Proj in worker")
    importScripts("projModule.js");
    const root = new Proj();
    registry.set('root', root);
    await root.init();
    console.log("initialized Proj in worker");
    return true;
}

self.onmessage = async function (e) {
    // snake_case destructuring
    const { correlation_id, object_id, method, args } = e.data;

    if (object_id === 'system' && method === 'get_status') {
        self.postMessage({
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

        // Check if the result is a Transformer (or any object we want to keep by reference)
        if (result instanceof Transformer) {
            const new_object_id = `transformer_${crypto.randomUUID()}`;
            g_object_registry.set(new_object_id, result);

            self.postMessage({
                correlation_id,
                status: 'success',
                // Return a Reference pointer
                result: { __type: 'REF', object_id: new_object_id }
            });
        } else {
            self.postMessage({
                correlation_id,
                status: 'success',
                result: result
            });
        }

    } catch (error) {
        self.postMessage({
            correlation_id,
            status: 'error',
            error: error.message
        });
    }
};
