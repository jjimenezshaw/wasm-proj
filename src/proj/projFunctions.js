"use strict"

// Small class to help to manage memory.
class Keeper {
    constructor(proj, debug = false) {
        if (!proj) {
            throw new Error("Empty proj ptr. Have you called Proj.init()?");
        }

        this.proj = proj;
        this.debug = debug;
        this.to_free = [];
        this.to_destroy = [];
        this.special_destroy = [];
    };

    add(ptr, proj_destroy = true) {
        if (proj_destroy) {
            if (this.debug)
                console.debug("add destroy", ptr);
            this.to_destroy.push(ptr);
        } else {
            if (this.debug)
                console.debug("add free", ptr);
            this.to_free.push(ptr);
        }
        return ptr;
    };

    call(name, ...args) {
        const ptr = this.proj[name](...args);
        return this.add(ptr, true);
    }

    call_destroyer(name, destroyer, ...args) {
        const ptr = this.proj[name](...args);
        if (this.debug)
            console.debug("add special destroyer", ptr, destroyer);
        this.special_destroy.push([destroyer, ptr]);
        return ptr;
    }

    malloc(ptrSize) {
        const ptr = this.proj._malloc(ptrSize);
        return this.add(ptr, false);
    };

    string(str) {
        const ptr = this.proj.stringToNewUTF8(str);
        return this.add(ptr, false);
    };

    clean() {
        this.special_destroy.reverse();
        for (const p of this.special_destroy) {
            const [destroyer, ptr] = p;
            if (this.debug)
                console.debug("call special destroyer", ptr, destroyer);
            this.proj[destroyer](ptr);
        }
        this.special_destroy = [];

        this.to_destroy.reverse();
        for (const p of this.to_destroy) {
            if (this.debug)
                console.debug("call destroy", p);
            this.proj._proj_destroy(p);
        }
        this.to_destroy = [];

        this.to_free.reverse();
        for (const p of this.to_free) {
            if (this.debug)
                console.debug("call free", p);
            this.proj._free(p);
        }
        this.to_free = [];
    };
};

function struct_ptr_to_dict(proj, struct_ptr, params) {
    /// params is [[name, type]]
    /// where type can be
    ///   string, i32, double
    /// if name = __ , it is ignored. Needed to count the offset
    let offset = 0;
    const dummy = "__";
    const res = {}
    for (const p of params) {
        const [name, type] = p;
        let v;
        switch (type) {
            case ("string"):
                v = proj.getValue(struct_ptr + offset, '*');
                offset += 4;
                res[name] = proj.UTF8ToString(v);
                break;
            case ("b32"):
                v = proj.getValue(struct_ptr + offset, 'i32');
                offset += 4;
                res[name] = !!v;
                break;
            case ("i32"):
                v = proj.getValue(struct_ptr + offset, 'i32');
                offset += 4;
                res[name] = v;
                break;
            case ("double"):
                v = proj.getValue(struct_ptr + offset, 'double');
                offset += 8;
                res[name] = v;
                break;
            default:
                throw new Error(`Unknown type [${type}] in struct_ptr_to_dict`)
        }
    }
    delete res[dummy];
    return res;
}

/** Class represeting a coordinate Transformer. Do not forget to call dispose() after usage.
 * It must be created with the methods in class Proj.
 */
class Transformer {
    constructor(proj, ctx, P) {
        this.proj = proj;
        this.ctx = ctx;
        this.P = P;
        const use_network = this.proj._proj_context_is_network_enabled(this.ctx);
        const is_worker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
        if (use_network && !is_worker) {
            console.warn("Using a PROJ transformer in the main thread with 'use_network' may not work as expected.")
        }
        this.last_op_inverse = false;
    }

    dispose() {
        this.proj._proj_destroy(this.P);
        this.P = undefined;
        this.proj._proj_destroy(this.ctx);
        this.ctx = undefined;
        this.proj = undefined;
    }

    angular_input(args) {
        return this.proj._proj_angular_input(this.P, args?.inverse ? -1 : 1);
    }
    degree_input(args) {
        return this.proj._proj_degree_input(this.P, args?.inverse ? -1 : 1);
    }
    angular_output(args) {
        return this.proj._proj_angular_output(this.P, args?.inverse ? -1 : 1);
    }
    degree_output(args) {
        return this.proj._proj_degree_output(this.P, args?.inverse ? -1 : 1);
    }

    transform(args) {
        const keep = new Keeper(this.proj);
        try {
            const points = args.points;
            const number_of_points = points.length;
            const inverse = args.inverse;
            this.last_op_inverse = inverse;

            let coordPtr = keep.malloc(32 * number_of_points);
            const coordView = new Float64Array(this.proj.HEAPF64.buffer, coordPtr, 4 * number_of_points);
            for (let p = 0; p < number_of_points; p++) {
                coordView[p * 4 + 0] = points[p][0];
                coordView[p * 4 + 1] = points[p][1];
                coordView[p * 4 + 2] = points[p].length > 2 ? points[p][2] : 0;
                coordView[p * 4 + 3] = points[p].length > 3 ? points[p][3] : Infinity; // HUGE_VAL
            }

            const r = this.proj._proj_trans_array(this.P, inverse ? -1 : 1, number_of_points, coordPtr);
            if (r != 0) {
                const msgPtr = this.proj._proj_context_errno_string(this.ctx, r);
                const msg = this.proj.UTF8ToString(msgPtr);
                throw new Error(`_proj_trans_array error ${msg}`);
            }

            let res = []
            for (let p = 0; p < number_of_points; p++) {
                let coord = [];
                coord.push(coordView[p * 4 + 0]);
                coord.push(coordView[p * 4 + 1]);
                if (points[p].length > 2) coord.push(coordView[p * 4 + 2]);
                if (points[p].length > 3) coord.push(coordView[p * 4 + 3]);
                res.push(coord);
            }
            return res;
        } finally {
            keep.clean()
        }
    }

    get_last_operation() {
        let keep = new Keeper(this.proj);
        try {
            // https://proj.org/en/stable/development/reference/datatypes.html#c.PJ_PROJ_INFO
            const struct_ptr = keep.malloc(64); // bigger just in case
            let operation_ptr = keep.call("_proj_trans_get_last_used_operation", this.P);
            if (this.last_op_inverse) {
                operation_ptr = keep.call("_proj_coordoperation_create_inverse", this.ctx, operation_ptr);
            }

            this.proj._proj_pj_info(struct_ptr, operation_ptr);
            const idPtr = this.proj.getValue(struct_ptr + 0, 'i32');
            const descriptionPtr = this.proj.getValue(struct_ptr + 4, 'i32');
            const definitionPtr = this.proj.getValue(struct_ptr + 8, 'i32');
            const has_inverse = !!this.proj.getValue(struct_ptr + 12, 'i32');
            const accuracy = this.proj.getValue(struct_ptr + 16, 'double');

            const PROJ_5 = 0;
            const PJ_WKT2_2019 = 2;

            const optionStr = "MULTILINE=YES";
            const optionStrPtr = keep.string(optionStr);

            // We need 8 bytes (two 32-bit pointers: one for the string, one for NULL)
            const optionsArrayPtr = keep.malloc(8);

            this.proj.setValue(optionsArrayPtr, optionStrPtr, 'i32');
            this.proj.setValue(optionsArrayPtr + 4, 0, 'i32'); // null terminator.

            const proj_5 = this.proj._proj_as_proj_string(this.ctx, operation_ptr, PROJ_5, optionsArrayPtr);
            const wkt2 = this.proj._proj_as_wkt(this.ctx, operation_ptr, PJ_WKT2_2019, 0);

            const res = {
                id: this.proj.UTF8ToString(idPtr),
                description: this.proj.UTF8ToString(descriptionPtr),
                definition: this.proj.UTF8ToString(definitionPtr),
                has_inverse: has_inverse,
                accuracy: accuracy,
                proj_5: this.proj.UTF8ToString(proj_5),
                wkt2: this.proj.UTF8ToString(wkt2),
            };
            return res;
        } finally {
            keep.clean();
        }
    }
};

/** Class for the general PROJ wasm wrapper. Do not forget to call init() */
class Proj {
    static current_script_url = typeof document !== 'undefined' ? document.currentScript.src : ''; // just for browser

    /** Created the Proj object */
    constructor() {
        this.proj;
        this.ctx;
        this.init_promise;
        this.ptr_size;
        this.geod_geodesic_ptr; // GRS80. Here for performance.
    }

    /**
     * callback for loaded init
     * @callback on_load_callback
     * @param {module} module
     */

    /**
     * callback for failed init
     * @callback on_failed_callback
     * @param {Error} error
     */

    /**
     * callback for log
     * @callback printer
     * @param {string} text
     */

    /** initializes the Proj object after construction *asynchronously*
     * calling the proper WASM module factory
     * @param {on_load_callback} [on_loaded]
     * @param {on_failed_callback} [on_failed]
     * @param {{wasm_dir: string, print: printer, printErr: printer}} [options]
     * @returns {Promise}
     */
    async init(on_loaded, on_failed, options) {
        if (typeof ProjModuleFactory === 'undefined') {
            throw new Error(
                "'ProjModuleFactory' is not defined. Have you loaded projModule.js?");
        }
        let wasm_dir = options?.wasm_dir;
        const module_config = {
            // locateFile intercepts requests for the .wasm file
            locateFile: function (fileName, defaultPrefix) {
                if (fileName.endsWith('.wasm')) {
                    const is_node = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
                    if (is_node) {
                        const path = require('path');
                        return path.join(__dirname, 'wasm', fileName);
                    } else {
                        const is_worker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
                        if (wasm_dir) {
                            // use this directory directly
                        } else if (is_worker) {
                            wasm_dir = 'wasm/';
                        } else {
                            const base_url = Proj.current_script_url;
                            wasm_dir = base_url.substring(0, base_url.lastIndexOf('/') + 1) + 'wasm/';
                        }
                        return wasm_dir + fileName;
                    }
                }
                return defaultPrefix + fileName;
            },
            print: options?.print, // This does not work in the worker
            printErr: options?.printErr, // This does not work in the worker
        };
        if (!this.init_promise) {
            this.init_promise = ProjModuleFactory(module_config);
        }
        return this.init_promise
            .then(module => {
                this.proj = this.proj ?? module;
                this.ctx = this.ctx ?? this.proj._proj_context_create();
                this.ptr_size = this.proj._get_ptr_size();
                if (this.ptr_size != 4) {
                    console.warn("Detected WASM64. Is this code prepared for that?")
                }

                on_loaded?.(module);
            })
            .catch(err => {
                console.error(`ProjModuleFactory init error: ${err}`);
                on_failed?.(err);
            });
    }

    // in case you want to clean the variables and memory, call this method.
    // obviously you cannot use it anymore, until you call "init" again.
    dispose() {
        if (this.init_promise && !this.proj) {
            console.error("Proj.dispose called during initialization. Unexpected behaviour.")
        }

        if (this.geod_geodesic_ptr) {
            this.proj._free(this.geod_geodesic_ptr);
            this.geod_geodesic_ptr = undefined;
        }
        if (this.proj) {
            this.proj._proj_destroy(this.ctx);
        }

        this.proj = undefined;
        this.ctx = undefined;
        this.init_promise = undefined;
        this.ptr_size = undefined;
    }

    // check if PROJ was properly loaded.
    is_loaded() {
        return !!this.proj;
    }

    // Helper function to read char**, like in _proj_cs_get_axis_info
    _charstarstar_to_string(ptr) {
        if (!ptr) {
            return "";
        }
        const str_ptr = this.proj.getValue(ptr, '*');
        if (!str_ptr) {
            return "";
        }
        const str = this.proj.UTF8ToString(str_ptr);
        return str;
    }

    // return: { compilation_date, major, minor, patch, release, version }
    proj_info() {
        let r = this.proj.proj_info_ems();
        r.compilation_date =
            this.proj.UTF8ToString(this.proj._get_compilation_date());
        return r;
    }

    /*
    PJ_LOG_NONE = 0,
    PJ_LOG_ERROR = 1,
    PJ_LOG_DEBUG = 2,
    PJ_LOG_TRACE = 3,
    PJ_LOG_TELL = 4,
    */
    log_level(level) {
        if (level === undefined || level === null)
            level = 4;
        if (level < 0 || level > 4)
            throw new Error(`Invalid PROJ log level [${level}]`);
        return this.proj._proj_log_level(this.ctx, level);
    }

    // equivalent to projinfo CLI https://proj.org/en/stable/apps/projinfo.html
    // args: { args, use_network }
    // return: { rc, msg }
    projinfo(args) {
        let msg = "";
        const callback = (level, message) => { msg += message; };

        const network_enabled =
            this.proj._proj_context_is_network_enabled(this.ctx);
        try {
            if (args.use_network != network_enabled)
                this.proj._proj_context_set_enable_network(this.ctx,
                    args.use_network);
            const rc = this.proj.projinfo_ems(this.ctx, args.args, callback);
            return { rc: rc, msg: msg };
        } finally {
            if (args.use_network != network_enabled)
                this.proj._proj_context_set_enable_network(this.ctx,
                    network_enabled);
        }
    }

    crs_axes(args) {
        const ptrSize = this.ptr_size;
        const doubleSize = 8; // Doubles are 8 bytes
        const PJ_TYPE_COMPOUND_CRS = 16; // from proj.h
        let keep = new Keeper(this.proj);
        let res = {};
        try {
            // this function declaration keeps the meaning of "this" from the class
            const internal_axes = (P_crs) => {
                const P_cs = keep.call("_proj_crs_get_coordinate_system",
                    this.ctx, P_crs);
                const axis_count =
                    this.proj._proj_cs_get_axis_count(this.ctx, P_cs);
                const outNamePtr = keep.malloc(ptrSize);
                const outAbbrevPtr = keep.malloc(ptrSize);
                const outDirectionPtr = keep.malloc(ptrSize);
                const outConvFactorPtr = keep.malloc(doubleSize);
                const outUnitPtr = keep.malloc(ptrSize);
                let res = {
                    name: [],
                    abbr: [],
                    direction: [],
                    conv_factor: [],
                    unit: []
                };
                for (let i = 0; i < axis_count; i++) {
                    const r = this.proj._proj_cs_get_axis_info(
                        this.ctx, P_cs, i, outNamePtr, outAbbrevPtr,
                        outDirectionPtr, outConvFactorPtr, outUnitPtr, 0, 0);
                    if (r != 1) {
                        throw new Error("error calling proj_cs_get_axis_info");
                    }

                    res.name.push(this._charstarstar_to_string(outNamePtr));
                    res.abbr.push(this._charstarstar_to_string(outAbbrevPtr));
                    res.direction.push(this._charstarstar_to_string(outDirectionPtr));
                    res.conv_factor.push(
                        this.proj.getValue(outConvFactorPtr, 'double'));
                    res.unit.push(this._charstarstar_to_string(outUnitPtr));
                }
                return res;
            };
            const sourceCRS = keep.string(args.crs);
            const P_crs = keep.call("_proj_create", this.ctx, sourceCRS);
            if (this.proj._proj_get_type(P_crs) == PJ_TYPE_COMPOUND_CRS) {
                const P_crs_0 = keep.call("_proj_crs_get_sub_crs", this.ctx, P_crs, 0);
                const P_crs_1 = keep.call("_proj_crs_get_sub_crs", this.ctx, P_crs, 1);
                res = internal_axes(P_crs_0);
                const res1 = internal_axes(P_crs_1);
                for (const key in res) {
                    res[key] = res[key].concat(res1[key]);
                }
            } else {
                res = internal_axes(P_crs);
            }
        } finally {
            keep.clean();
        }
        return res;
    }

    /**
     * Creates a coordinate transformer from CRS definition
     * @example
     * create_transformer_from_crs({source_crs: 'EPSG:4326', target_crs: 'EPSG:2056'})
     * @param {Object} args
     * @param {string} args.source_crs
     * @param {string} args.target_crs
     * @param {number} [args.source_epoch] - Only for dynamic datums
     * @param {number} [args.target_epoch] - Only for dynamic datums
     * @param {boolean} [args.promote_to_3D] - Use 3D transformations even for 2D systems
     * @param {boolean} [args.use_network] - use network when grid files are needed. Must run in a Web Worker
     * @param {boolean} [args.always_xy] - use lon-lat and easting-northing for input and output, regardless the CRS definitions.
     * @returns {Transformer}
     */
    create_transformer_from_crs(args) {
        const keep = new Keeper(this.proj);
        try {
            const source_crs = keep.string(args?.source_crs);
            const target_crs = keep.string(args?.target_crs);
            const area = 0;

            let P_src = keep.call("_proj_create", this.ctx, source_crs);
            let P_tgt = keep.call("_proj_create", this.ctx, target_crs);
            if (args?.promote_to_3D) {
                P_src = keep.call("_proj_crs_promote_to_3D", this.ctx, 0, P_src);
                P_tgt = keep.call("_proj_crs_promote_to_3D", this.ctx, 0, P_tgt);
            }
            const process_epoch = (P, epoch, name) => {
                let P_out = P;
                if (epoch !== null && epoch !== undefined && !isNaN(epoch)) {
                    if (typeof epoch !== "number") {
                        throw new Error(`Epoch ${epoch} must be a float`)
                    }
                    P_out = keep.call("_proj_coordinate_metadata_create", this.ctx, P, epoch);
                    if (P_out == 0) {
                        P_out = P;
                        console.error(`Apparently ${name} is not dynamic. Do not use an epoch.`)
                    }
                }
                return P_out;
            }
            P_src = process_epoch(P_src, args?.source_epoch, args?.source_crs);
            P_tgt = process_epoch(P_tgt, args?.target_epoch, args?.target_crs);

            const ctx = this.proj._proj_context_clone(this.ctx);
            this.proj._proj_context_set_enable_network(ctx, args.use_network);
            let P = this.proj._proj_create_crs_to_crs_from_pj(ctx, P_src, P_tgt, area, 0);
            if (P === 0) {
                this.proj._proj_destroy(ctx);
                throw new Error("proj_create_crs_to_crs_from_pj returned NULL.");
            }
            if (args.always_xy) {
                const Q = this.proj._proj_normalize_for_visualization(ctx, P);
                this.proj._proj_destroy(P);
                P = Q;
                if (P === 0) {
                    this.proj._proj_destroy(ctx);
                    throw new Error("proj_normalize_for_visualization returned NULL.");
                }
            }
            // the ownership of P and ctx is transfered to the transformer
            const tr = new Transformer(this.proj, ctx, P);
            return tr;
        } finally {
            keep.clean();
        }
    }

    /**
     * Creates a coordinate transformer from a single string
     * @param {Object} args
     * @param {string} args.pipeline
     * @param {boolean} [args.use_network] - use network when grid files are needed. Must run in a Web Worker
     * @returns {Transformer}
     */
    create_transformer_from_pipeline(args) {
        const keep = new Keeper(this.proj);
        try {
            const pipeline = keep.string(args?.pipeline);
            const ctx = this.proj._proj_context_clone(this.ctx);
            this.proj._proj_context_set_enable_network(ctx, args.use_network ? 1 : 0);
            let P = this.proj._proj_create(ctx, pipeline);
            if (P === 0) {
                this.proj._proj_destroy(ctx);
                throw new Error("proj_create returned NULL.");
            }
            // the ownership of P and ctx is transfered to the transformer
            const tr = new Transformer(this.proj, ctx, P);
            return tr;
        } finally {
            keep.clean();
        }
    }

    /**
     * @typedef {Object} crs_metadata_result
     * @property {boolean} is_crs - Indicates if the input was really a CRS definition.
     * @property {number} type - PROJ type
     * @property {string} name - Name of the CRS
     * @property {boolean} is_deprecated - Indicates if the CRS is deprecated in the catalog
     * @property {boolean} is_derived - Indicates if the CRS is derived
     */
    /**
     * Gets metadata of a CRS
     * @param {Object} args
     * @param {string} args.crs - definition of the CRS
     * @returns {crs_metadata_result} the metadata
     */
    crs_metadata(args) {
        const keep = new Keeper(this.proj);
        const res = {};
        try {
            const crs = keep.string(args?.crs);
            const P_crs = keep.call("_proj_create", this.ctx, crs);
            const is_crs = !!this.proj._proj_is_crs(P_crs);
            res.is_crs = is_crs;
            res.type = this.proj._proj_get_type(P_crs);
            res.name = P_crs ? this.proj.UTF8ToString(this.proj._proj_get_name(P_crs)) : '';
            res.is_deprecated = !!this.proj._proj_is_deprecated(P_crs);
            res.is_derived = is_crs ? !!this.proj._proj_crs_is_derived(this.ctx, P_crs) : false;
            return res;
        } finally {
            keep.clean();
        }
    }

    /**
     * @typedef {Object} datum_metadata_result
     * @property {number} type - PROJ type of the CRS datum
     * @property {string} name - Name of the CRS datum
     * @property {boolean} is_dynamic - Indicates if the CRS datum is dynamic
     */
    /**
     * Gets metadata of the datum of a CRS
     * @param {Object} args
     * @param {string} args.crs - definition of the CRS
     * @returns {datum_metadata_result} the metadata
     */
    datum_metadata(args) {
        const keep = new Keeper(this.proj);
        const res = {};
        const PJ_TYPE_UNKNOWN = 0;
        const PJ_TYPE_DYNAMIC_GEODETIC_REFERENCE_FRAME = 4;
        const PJ_TYPE_DYNAMIC_VERTICAL_REFERENCE_FRAME = 6;
        try {
            const crs = keep.string(args?.crs);
            const P_crs = keep.call("_proj_create", this.ctx, crs);
            const is_crs = !!this.proj._proj_is_crs(P_crs);
            const P_datum = is_crs ? keep.call("_proj_crs_get_datum_forced", this.ctx, P_crs) : 0;
            res.type = P_datum == 0 ? PJ_TYPE_UNKNOWN : this.proj._proj_get_type(P_datum)
            res.name = P_datum == 0 ? '' : this.proj.UTF8ToString(this.proj._proj_get_name(P_datum));
            res.is_dynamic = res.type == PJ_TYPE_DYNAMIC_GEODETIC_REFERENCE_FRAME ||
                res.type == PJ_TYPE_DYNAMIC_VERTICAL_REFERENCE_FRAME;
            return res;
        } finally {
            keep.clean();
        }
    }

    /**
     * List the CRSs from proj.db
     * @param {Object} args
     * @param {number} [args.auth_name] - Authority name. If empty, all authorities are used
     * @returns {list}
     */
    crs_list(args) {
        const keep = new Keeper(this.proj);
        try {
            const auth_name = args?.auth_name ? keep.string(args.auth_name) : 0;
            const params = 0;
            const count_ptr = keep.malloc(4);
            const crs_info_list_ptr = keep.call_destroyer(
                "_proj_get_crs_info_list_from_database",
                "_proj_crs_info_list_destroy",
                this.ctx, auth_name, params, count_ptr);
            const count = this.proj.getValue(count_ptr, 'i32');
            const ppp = [
                ["auth", "string"],
                ["code", "string"],
                ["name", "string"],
                ["type", "i32"],
                ["deprecated", "b32"],
                ["bbox_valid", "b32"],
                ["west_lon_degree", "double"],
                ["south_lon_degree", "double"],
                ["east_lon_degree", "double"],
                ["north_lon_degree", "double"],
                ["area_name", "string"],
                ["projection_method_name", "string"],
                ["celestial_body_name", "string"]];
            const list = []
            for (let i = 0; i < count; i++) {
                const info_struct_ptr = this.proj.getValue(crs_info_list_ptr + (i * 4), '*');
                const elem = struct_ptr_to_dict(this.proj, info_struct_ptr, ppp)
                list.push(elem);
            }
            return list;
        } finally {
            keep.clean();
        }
    }

    /**
     * @typedef {Object} factors_result
     * @property {number} meridional_scale -
     * @property {number} parallel_scale
     * @property {number} areal_scale
     * @property {number} angular_distortion - degrees
     * @property {number} meridian_parallel_angle - degrees
     * @property {number} meridian_convergence - degrees
     * @property {number} tissot_semimajor
     * @property {number} tissot_semiminor
     * @property {number} dx_dlam
     * @property {number} dx_dphi
     * @property {number} dy_dlam
     * @property {number} dy_dphi
     * @property {number} lat - degrees
     * @property {number} lon - degrees
     * @property {number} error_code - error generated by PROJ. 0 on success.
     * @property {string} [error_msg] - error message when error_code is not 0.
     */
    /**
     * Gets the distortion factors of a projected crs
     * @param {Object} args
     * @param {string} args.crs - definition of the CRS
     * @param {list} args.points - {lat:, lon:} or [lat, lon]
     * @returns {list{factors_result}} - list of factors
     */
    factors(args) {
        const keep = new Keeper(this.proj);
        try {
            const crs = keep.string(args?.crs);
            const P_crs = keep.call("_proj_create", this.ctx, crs);
            if (P_crs == 0) {
                throw Error(`cannot create valid object from this: ${args.crs}`);
            }

            const coord_ptr = keep.malloc(32);
            const coord_index = coord_ptr / 8;
            this.proj.HEAPF64[coord_index + 2] = 0; // z
            this.proj.HEAPF64[coord_index + 3] = 0; // t

            const factors_ptr = keep.malloc(96);
            const ppp = [
                ["meridional_scale", "double"],
                ["parallel_scale", "double"],
                ["areal_scale", "double"],
                ["angular_distortion", "double"],
                ["meridian_parallel_angle", "double"],
                ["meridian_convergence", "double"],
                ["tissot_semimajor", "double"],
                ["tissot_semiminor", "double"],
                ["dx_dlam", "double"],
                ["dx_dphi", "double"],
                ["dy_dlam", "double"],
                ["dy_dphi", "double"]]
            const res = [];
            for (let point of args?.points) {
                if ((point.lat === undefined || point.lon === undefined) && point.length < 2) {
                    throw Error('Invalid input point');
                }
                const lat = point.lat ?? point[0];
                const lon = point.lon ?? point[1];
                const lat_rad = this.proj._proj_torad(lat);
                const lon_rad = this.proj._proj_torad(lon);

                this.proj.HEAPF64[coord_index + 0] = lon_rad;
                this.proj.HEAPF64[coord_index + 1] = lat_rad;
                this.proj._proj_factors(factors_ptr, P_crs, coord_ptr);
                const error_code = this.proj._proj_errno(P_crs);
                if (error_code) this.proj._proj_errno_reset(P_crs);

                const elem = struct_ptr_to_dict(this.proj, factors_ptr, ppp)
                for (let key of ['angular_distortion', 'meridian_parallel_angle', 'meridian_convergence']) {
                    elem[key] = this.proj._proj_todeg(elem[key]);
                }
                elem.lat = lat;
                elem.lon = lon;
                elem.error_code = error_code;
                if (error_code) {
                    const msgPtr = this.proj._proj_context_errno_string(this.ctx, error_code);
                    elem.error_msg = this.proj.UTF8ToString(msgPtr);
                }
                res.push(elem);
            }
            return res;
        } finally {
            keep.clean();
        }
    }

    geodesic_direct(args) {
        const keep = new Keeper(this.proj);
        try {
            const geod_geodesic_size = 64 * 8; // there are about 51 doubles in the struc. Take some margin.
            let geod_geodesic_ptr;
            if (!args.a) {
                // use the ptr in proj cache for GRS80. Do not store in keeper.
                if (!this.geod_geodesic_ptr) {
                    this.geod_geodesic_ptr = this.proj._malloc(geod_geodesic_size);
                    this.proj._geod_init(this.geod_geodesic_ptr, 6378137, 1 / 298.257222101); // GRS80
                }
                geod_geodesic_ptr = this.geod_geodesic_ptr;
            } else {
                geod_geodesic_ptr = keep.malloc(geod_geodesic_size);
                this.proj._geod_init(geod_geodesic_ptr, args.a, args.f);
            }
            const double_size = 8;
            const lat2_ptr = keep.malloc(double_size);
            const lon2_ptr = keep.malloc(double_size);
            const azi2_ptr = keep.malloc(double_size);
            let res = [];
            for (let p of args.points) {
                this.proj._geod_direct(geod_geodesic_ptr,
                    p.lat1, p.lon1, p.azi1, p.s12,
                    lat2_ptr, lon2_ptr, azi2_ptr);
                const e = {
                    lat2: this.proj.getValue(lat2_ptr, 'double'),
                    lon2: this.proj.getValue(lon2_ptr, 'double'),
                    azi2: this.proj.getValue(azi2_ptr, 'double'),
                }
                res.push(e);
            }
            return res;
        } finally {
            keep.clean();
        }
    }
}

if (typeof exports === 'object' && typeof module === 'object') {
    module.exports = { Proj: Proj }
}
