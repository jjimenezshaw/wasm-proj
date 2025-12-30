onmessage = (e) => {
    if(e.data.type == "transform") {
        computeTransform(e.data);
    } else if(e.data.type == "info") {
        get_proj_info(e.data);
    } else if(e.data.type == "projinfo") {
        get_projinfo(e.data);
    } else {
        throw new Error("unknown message on worker");
    }
};

let proj = null; // PROJ module from wasm
let ctx = null;

function get_proj_info(data) {
    const type = "info";
    let r = proj.proj_info_ems();
    r.compilation_date = proj.UTF8ToString(proj._get_compilation_date());
    postMessage({type: type, input: data, info: r});
}

function get_projinfo(data) {
    let msgs = [];
    const myCallback = (level, message) => {
        let lastElement = msgs.slice(-1);
        if (!lastElement.length || level.value != lastElement[0].level) {
            msgs.push({level: level.value, msg: ""});
            lastElement = msgs.slice(-1);
        }
        lastElement[0].msg += message;
    };

    const type = "projinfo";
    const args = data.args ?? [];
    ctx = ctx ?? proj._proj_context_create();
    let rc = proj.projinfo_ems(ctx, args, myCallback);
    console.log(msgs);
    postMessage({type: type, input: data, msgs: msgs});
}

function computeTransform(data) {
    const type = "transform"
    if (data.type != type) {
        postMessage({type: type, input: data,
            error: `type is not ${type}`});
        return;
    }
    if (!data.src || !data.dst || data.coord?.length < 3) {
        postMessage({type: type, input: data,
            error: `Missing input data ${data}`});
        return;
    }
    let P = null;
    let sourceCRS, targetCRS;
    let coordPtr;
    try {
        if (!ctx) {
            console.log("Creating PROJ context...");
            ctx = proj._proj_context_create();
            console.log(`Context created (ptr: ${ctx})`, 'success');
        }
        if (ctx === 0) {
            throw new Error("proj_context_create returned NULL");
        }
        proj._proj_context_set_enable_network(ctx, data.use_network);

        // --- Create Transformation ---
        console.log("Creating transformation...");
        let src = data.src;
        let dst = data.dst;
        if (src == '' || dst == '') {
                throw new Error("src and dst must be filled");
        }
        let x = data.coord[0];
        let y = data.coord[1];
        let z = data.coord[2];

        sourceCRS = proj.stringToNewUTF8(src);
        targetCRS = proj.stringToNewUTF8(dst);

        P = proj._proj_create_crs_to_crs(
            ctx, sourceCRS, targetCRS, 0
        );
        if (P === 0) {
            throw new Error("proj_create_from_database returned NULL. Is proj.db embedded?");
        }
        console.log(`Transformation created (ptr: ${P})`, 'success');

        // Create a PROJ_COORD struct in memory
        // PJ_COORD is 4 doubles: (x, y, z, t) or (lon, lat, z, t)
        // We need 4 * 8 = 32 bytes of memory
        coordPtr = proj._malloc(32);

        // Get a view of the memory as 64-bit floats
        const coordView = new Float64Array(proj.HEAPF64.buffer, coordPtr, 4);
        coordView[0] = x;
        coordView[1] = y;
        coordView[2] = z;
        coordView[3] = Infinity; // HUGE_VAL

        // Perform the transformation
        let res = proj._proj_trans_array(P, 1, 1, coordPtr);
        if (res != 0) {
            let msgPtr = proj._proj_context_errno_string(ctx, res);
            let msg = proj.UTF8ToString(msgPtr);
            postMessage({type: type, input: data, error: msg});
            return;
        }

        // Read the output coordinate
        const outX = coordView[0];
        const outY = coordView[1];
        const outZ = coordView[2];
        postMessage({type: type, input: data, res: [outX, outY, outZ]});

        console.log(`Transformed: x=${outX}, y=${outY}, z=${outZ}`);
    } catch (e) {
        postMessage({type: type, input: data, error: e.message})
        console.error(`TEST FAILED: ${e.message}`);
        return;
    } finally {
        console.log("Cleaning up memory...");
        if (coordPtr) { proj._free(coordPtr); coordPtr = null; }
        if (P) { proj._proj_destroy(P); P = null; }
        if (sourceCRS) { proj._free(sourceCRS); sourceCRS = null; }
        if (targetCRS) { proj._free(targetCRS); targetCRS = null; }
        //if (ctx) { proj._proj_context_destroy(ctx); ctx = null; }
        console.log("Cleanup complete.", 'success');
        console.log("------------------------------");
    }
}

importScripts("projModule.js");
if (typeof ProjModuleFactory === 'undefined') {
    console.error("'ProjModuleFactory' is not defined. Have you loaded projModule.js.");
} else {
    ProjModuleFactory().then(module => {
        proj = module;
        console.log("loaded module");



        postMessage({type: "loaded", loaded: true});
    }).catch(err => {
        console.error(`Failed to instantiate Wasm module: ${err}`);
        console.error("This often fails if the required Cross-Origin HTTP headers are not set by the server or coi-serviceworker.js.");
    });
}
