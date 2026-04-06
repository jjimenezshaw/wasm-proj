/*
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

/** Small internal class to help to manage memory.
 * It is kind of a manual garbage collector, designed to work in a function that uses wasm calls and objects.
 * It has methods to deal with the proj_destroy function, and with usual wasm malloc and free.
 * Do not forget to call 'clean()' at the end, usually in a 'finally' statement
 * @class
 */
class Keeper {
    /**
     * Creates a new Keeper
     * @param {object} proj - Proj module from wasm
     * @param {boolean} debug - enable to log the creation and destruction of the objects.
     */
    constructor(proj, debug = false) {
        if (!proj) {
            throw new Error('Empty proj ptr. Have you called Proj.init()?');
        }

        this.proj = proj;
        this.debug = debug;
        this.to_free = [];
        this.to_destroy = [];
        this.special_destroy = [];
    }

    /**
     * Adds a pointer to take care of it, destroying or freeing it later on 'clean()'.
     * @param {number} ptr - pointer to add to this keeper.
     * @param {boolean} proj_destroy - flag telling if the object must be destroyed with proj_destroy
     * @returns {number} - The same pointer provided
     */
    add(ptr, proj_destroy = true) {
        if (proj_destroy) {
            if (this.debug) console.debug('add destroy', ptr);
            this.to_destroy.push(ptr);
        } else {
            if (this.debug) console.debug('add free', ptr);
            this.to_free.push(ptr);
        }
        return ptr;
    }

    /**
     * Calls a proj function with those parameters,
     * and registers the pointer to be destroyed with proj_destroy.
     * @param {string} name - proj function name
     * @param  {...any} args - arguments for function 'name'
     * @returns {number} the created pointer
     */
    call(name, ...args) {
        const ptr = this.proj[name](...args);
        return this.add(ptr, true);
    }

    /**
     * Similar to call(), but you specify the destructor function name, not proj_destroy.
     * @param {string} name - proj function name
     * @param {string} destroyer - proj function destroyer name.
     * @param  {...any} args - arguments for function 'name'
     * @returns {number} - the created pointer
     */
    call_destroyer(name, destroyer, ...args) {
        const ptr = this.proj[name](...args);
        if (this.debug) console.debug('add special destroyer', ptr, destroyer);
        this.special_destroy.push([destroyer, ptr]);
        return ptr;
    }

    /**
     * Allocates memory in wasm, and registers to be freed.
     * @param {*} ptr_size - size to allocate in bytes.
     * @returns {number} - the created pointer
     */
    malloc(ptr_size) {
        const ptr = this.proj._malloc(ptr_size);
        return this.add(ptr, false);
    }

    /**
     * Converts a javascript string into a new UTF8, and resgisters to be freed
     * @param {string} str - javascript string
     * @returns {number} - the created pointer
     */
    string(str) {
        const ptr = this.proj.stringToNewUTF8(str);
        return this.add(ptr, false);
    }

    /**
     * Creates a C pointer with the vector of strings as PROJ expects
     * @param {string[]} options - vector of options to add
     * @returns {number} - the created pointer
     */
    multi_string_options(options) {
        if (!Array.isArray(options)) {
            throw Error('multi_string_options expects an array');
        }
        const len = options.length;
        // We need 4*(n + 1) bytes (32-bit pointers: n for the strings, one for NULL)
        const options_array_ptr = this.malloc((len + 1) * 4);
        let i = 0;
        for (; i < len; i++) {
            const opt = options[i];
            const opt_ptr = this.string(opt);
            this.proj.setValue(options_array_ptr + 4 * i, opt_ptr, 'i32');
        }
        this.proj.setValue(options_array_ptr + 4 * i, 0, 'i32'); // null terminator.
        return options_array_ptr;
    }

    /**
     * Destroys every pointer registered.
     */
    clean() {
        this.special_destroy.reverse();
        for (const p of this.special_destroy) {
            const [destroyer, ptr] = p;
            if (this.debug) console.debug('call special destroyer', ptr, destroyer);
            this.proj[destroyer](ptr);
        }
        this.special_destroy = [];

        this.to_destroy.reverse();
        for (const p of this.to_destroy) {
            if (this.debug) console.debug('call destroy', p);
            this.proj._proj_destroy(p);
        }
        this.to_destroy = [];

        this.to_free.reverse();
        for (const p of this.to_free) {
            if (this.debug) console.debug('call free', p);
            this.proj._free(p);
        }
        this.to_free = [];
    }
}

function struct_ptr_to_dict(proj, struct_ptr, params) {
    /// params is [[name, type]]
    /// where type can be
    ///   string, b32, i32, double
    /// if name == __ , it is ignored. Needed to count the offset
    let offset = 0;
    const dummy = '__';
    const res = {};
    for (const p of params) {
        const [name, type] = p;
        let v;
        switch (type) {
            case 'string':
                v = proj.getValue(struct_ptr + offset, '*');
                offset += 4;
                res[name] = proj.UTF8ToString(v);
                break;
            case 'b32':
                v = proj.getValue(struct_ptr + offset, 'i32');
                offset += 4;
                res[name] = !!v;
                break;
            case 'i32':
                v = proj.getValue(struct_ptr + offset, 'i32');
                offset += 4;
                res[name] = v;
                break;
            case 'double':
                v = proj.getValue(struct_ptr + offset, 'double');
                offset += 8;
                res[name] = v;
                break;
            default:
                throw new Error(`Unknown type [${type}] in struct_ptr_to_dict`);
        }
    }
    delete res[dummy];
    return res;
}

// function _transform_internal(keep, proj, points, inverse, P_transformer, always_full_output) {
//     const number_of_points = points.length;
//     const coord_ptr = keep.malloc(32 * number_of_points); // 4 doubles.
//     const coordView = new Float64Array(proj.HEAPF64.buffer, coord_ptr, 4 * number_of_points);
//     for (let p = 0; p < number_of_points; p++) {
//         coordView[p * 4 + 0] = points[p][0];
//         coordView[p * 4 + 1] = points[p][1];
//         coordView[p * 4 + 2] = points[p].length > 2 ? points[p][2] : 0;
//         coordView[p * 4 + 3] = points[p].length > 3 ? points[p][3] : Infinity; // HUGE_VAL
//     }

//     const r = proj._proj_trans_array(P_transformer, inverse ? -1 : 1, number_of_points, coord_ptr);
//     if (r !== 0) {
//         const msg_ptr = proj._proj_context_errno_string(this.ctx, r);
//         const msg = proj.UTF8ToString(msg_ptr);
//         throw new Error(`_proj_trans_array error ${msg}`);
//     }

//     const res = [];
//     for (let p = 0; p < number_of_points; p++) {
//         const coord = [];
//         coord.push(coordView[p * 4 + 0]);
//         coord.push(coordView[p * 4 + 1]);
//         if (always_full_output || points[p].length > 2) coord.push(coordView[p * 4 + 2]);
//         if (always_full_output || points[p].length > 3) coord.push(coordView[p * 4 + 3]);
//         res.push(coord);
//     }
//     return res;
// }

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
            console.warn("Using a PROJ transformer in the main thread with 'use_network' may not work as expected.");
        }
        this.last_op_inverse = false;
    }

    /** Function to destroy the wasm pointers. Call it once you are done.
     * Calling any other method afterwards will fail.
     */
    dispose() {
        this.proj._proj_destroy(this.P);
        this.P = undefined;
        this.proj._proj_destroy(this.ctx);
        this.ctx = undefined;
        this.proj = undefined;
    }

    /**
     * @param {Object} [args]
     * @param {boolean} [args.inverse] - use the inverse operation.
     * @returns {boolean} true if the input of the transformation is in radians
     */
    angular_input(args) {
        return this.proj._proj_angular_input(this.P, args?.inverse ? -1 : 1);
    }
    /**
     * @param {Object} [args]
     * @param {boolean} [args.inverse] - use the inverse operation.
     * @returns {boolean} true if the input of the transformation is in degrees
     */
    degree_input(args) {
        return this.proj._proj_degree_input(this.P, args?.inverse ? -1 : 1);
    }
    /**
     * @param {Object} [args]
     * @param {boolean} [args.inverse] - use the inverse operation.
     * @returns {boolean} true if the output of the transformation is in radians
     */
    angular_output(args) {
        return this.proj._proj_angular_output(this.P, args?.inverse ? -1 : 1);
    }
    /**
     * @param {Object} [args]
     * @param {boolean} [args.inverse] - use the inverse operation.
     * @returns {boolean} true if the output of the transformation is in degrees
     */
    degree_output(args) {
        return this.proj._proj_degree_output(this.P, args?.inverse ? -1 : 1);
    }

    /**
     *
     * @param {Object} args
     * @param {number[][]} args.points - vector of points to transform
     * @param {boolean} [args.inverse] - apply the inverse operation.
     * @returns {number[][]}
     */
    transform(args) {
        const keep = new Keeper(this.proj);
        try {
            const points = args.points;
            const number_of_points = points.length;
            const inverse = args.inverse;
            this.last_op_inverse = inverse;

            const coord_ptr = keep.malloc(32 * number_of_points); // 4 doubles.
            const coordView = new Float64Array(this.proj.HEAPF64.buffer, coord_ptr, 4 * number_of_points);
            for (let p = 0; p < number_of_points; p++) {
                coordView[p * 4 + 0] = points[p][0];
                coordView[p * 4 + 1] = points[p][1];
                coordView[p * 4 + 2] = points[p].length > 2 ? points[p][2] : 0;
                coordView[p * 4 + 3] = points[p].length > 3 ? points[p][3] : Infinity; // HUGE_VAL
            }

            const r = this.proj._proj_trans_array(this.P, inverse ? -1 : 1, number_of_points, coord_ptr);
            if (r !== 0) {
                const msg_ptr = this.proj._proj_context_errno_string(this.ctx, r);
                const msg = this.proj.UTF8ToString(msg_ptr);
                throw new Error(`_proj_trans_array error ${msg}`);
            }

            const res = [];
            for (let p = 0; p < number_of_points; p++) {
                const coord = [];
                coord.push(coordView[p * 4 + 0]);
                coord.push(coordView[p * 4 + 1]);
                if (points[p].length > 2) coord.push(coordView[p * 4 + 2]);
                if (points[p].length > 3) coord.push(coordView[p * 4 + 3]);
                res.push(coord);
            }
            return res;
        } finally {
            keep.clean();
        }
    }

    /**
     * @typedef {Object} get_last_operation_result
     * @property {string} id - id of the operation
     * @property {string} description
     * @property {string} definition
     * @property {boolean} has_inverse
     * @property {number} accuracy
     * @property {string} proj_5 - proj pipeline multiline represantion
     * @property {string} wkt2 - WKT2 multiline representation
     */
    /**
     * Returns proj_pj_info for the last operation, with some extra representations.
     * If called before doing any transformation it will fail.
     * @returns {get_last_operation_result} - last operation information
     */
    get_last_operation() {
        const keep = new Keeper(this.proj);
        try {
            // https://proj.org/en/stable/development/reference/datatypes.html#c.PJ_PROJ_INFO
            const struct_ptr = keep.malloc(64); // bigger just in case
            let operation_ptr = keep.call('_proj_trans_get_last_used_operation', this.P);
            if (this.last_op_inverse) {
                operation_ptr = keep.call('_proj_coordoperation_create_inverse', this.ctx, operation_ptr);
            }

            this.proj._proj_pj_info(struct_ptr, operation_ptr);
            const id_ptr = this.proj.getValue(struct_ptr + 0, 'i32');
            const description_ptr = this.proj.getValue(struct_ptr + 4, 'i32');
            const definition_ptr = this.proj.getValue(struct_ptr + 8, 'i32');
            const has_inverse = !!this.proj.getValue(struct_ptr + 12, 'i32');
            const accuracy = this.proj.getValue(struct_ptr + 16, 'double');

            const PROJ_5 = 0;
            const PJ_WKT2_2019 = 2;

            const options_array_ptr = keep.multi_string_options(['MULTILINE=YES']);
            const proj_5 = this.proj._proj_as_proj_string(this.ctx, operation_ptr, PROJ_5, options_array_ptr);
            const wkt2 = this.proj._proj_as_wkt(this.ctx, operation_ptr, PJ_WKT2_2019, 0);

            const res = {
                id: this.proj.UTF8ToString(id_ptr),
                description: this.proj.UTF8ToString(description_ptr),
                definition: this.proj.UTF8ToString(definition_ptr),
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
}

/** Class for the general PROJ wasm wrapper. Do not forget to call init() */
class Proj {
    static current_script_url = typeof document !== 'undefined' ? document.currentScript.src : ''; // just for browser

    static PJ_TYPE_UNKNOWN = 0;
    static PJ_TYPE_DYNAMIC_GEODETIC_REFERENCE_FRAME = 4;
    static PJ_TYPE_DYNAMIC_VERTICAL_REFERENCE_FRAME = 6;

    static PJ_TYPE_GEOCENTRIC_CRS = 10;
    static PJ_TYPE_GEOGRAPHIC_2D_CRS = 12;
    static PJ_TYPE_GEOGRAPHIC_3D_CRS = 13;
    static PJ_TYPE_VERTICAL_CRS = 14;
    static PJ_TYPE_PROJECTED_CRS = 15;
    static PJ_TYPE_COMPOUND_CRS = 16;
    static PJ_TYPE_DERIVED_PROJECTED_CRS = 28;

    /** Created the Proj object */
    constructor() {
        this.proj;
        this.ctx;
        this.init_promise;
        this.ptr_size;
        this.geod_geodesic_ptr; // GRS80. Here for performance.
        this.user_db = { name: [], aux_names: [] };
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
     * callback for log. It doesn't work in the Worker.
     * @callback printer
     * @param {string} text
     */
    /** initializes the Proj object after construction *asynchronously*
     * calling the proper WASM module factory
     * @param {on_load_callback} [on_loaded]
     * @param {on_failed_callback} [on_failed]
     * @param {{wasm_dir: string, print: printer, printErr: printer}} [options]
     * @returns {Promise<void>}
     */
    async init(on_loaded, on_failed, options) {
        if (typeof ProjModuleFactory === 'undefined') {
            throw new Error("'ProjModuleFactory' is not defined. Have you loaded projModule.js?");
        }
        let wasm_dir = options?.wasm_dir;
        const module_config = {
            // locateFile intercepts requests for the .wasm file
            locateFile: (fileName, defaultPrefix) => {
                if (fileName.endsWith('.wasm')) {
                    const is_node =
                        typeof process !== 'undefined' && process.versions !== null && process.versions.node !== null;
                    if (is_node) {
                        const path = require('node:path');
                        return path.join(__dirname, 'wasm', fileName);
                    } else {
                        const is_worker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
                        if (wasm_dir) {
                            // use this directory directly
                        } else if (is_worker) {
                            wasm_dir = 'wasm/';
                        } else {
                            const base_url = Proj.current_script_url;
                            wasm_dir = `${base_url.substring(0, base_url.lastIndexOf('/') + 1)}wasm/`;
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
            .then((module) => {
                this.proj = this.proj ?? module;
                this.ctx = this.ctx ?? this.proj._proj_context_create();
                this.ptr_size = this.proj._get_ptr_size();
                if (this.ptr_size !== 4) {
                    console.warn('Detected WASM64. Is this code prepared for that?');
                }

                on_loaded?.(module);
            })
            .catch((err) => {
                console.error(`ProjModuleFactory init error: ${err}`);
                on_failed?.(err);
            });
    }

    /**
     * Set main and/or auxiliary databases.
     * To reset the main or auxiliary dbs, set a null. undefined will keep the previous state.
     * Notice that the usage of auxiliary dbs in PROJ slows down the access, even to the main db.
     * The names of the aux_dbs must be different. They are used in the local wasm FS.
     * @example
     * set_database({aux_dbs: [{name:'nsrs_proj.db', array_buffer: ...}] })
     * @param {Object} args
     * @param {{name: string, array_buffer: ArrayBuffer}} [args.db] - Name and content of the main db.
     * @param {{name: string, array_buffer: ArrayBuffer}[]} [args.aux_dbs] - string of name and content of the aux dbs.
     * @returns {number} - True in case of success, as in proj_context_set_database_path
     */
    set_database(args) {
        const keep = new Keeper(this.proj);
        try {
            const process_dbs = (names, dbs) => {
                for (const to_unlink of names) {
                    this.proj.FS.unlink(to_unlink);
                }
                names.splice(0); // delete the content, keep the same object by ref.
                if (dbs) {
                    dbs.forEach((db) => {
                        if (db) {
                            const name = `/${db.name}`;
                            const uint8_array = new Uint8Array(db.array_buffer);
                            this.proj.FS.writeFile(name, uint8_array);
                            names.push(name);
                        }
                    });
                }
            };

            if (args.db !== undefined) {
                process_dbs(this.user_db.name, [args.db]);
            }
            const name_ptr = this.user_db.name.length ? keep.string(this.user_db.name[0]) : 0;

            if (args.aux_dbs !== undefined) {
                process_dbs(this.user_db.aux_names, args.aux_dbs);
            }
            const aux_names_ptr = this.user_db.aux_names ? keep.multi_string_options(this.user_db.aux_names) : 0;

            const res = this.proj._proj_context_set_database_path(this.ctx, name_ptr, aux_names_ptr, 0);
            return res;
        } finally {
            keep.clean();
        }
    }

    // in case you want to clean the variables and memory, call this method.
    // obviously you cannot use it anymore, until you call "init" again.
    dispose() {
        if (this.init_promise && !this.proj) {
            console.error('Proj.dispose called during initialization. Unexpected behaviour.');
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
            return '';
        }
        const str_ptr = this.proj.getValue(ptr, '*');
        if (!str_ptr) {
            return '';
        }
        const str = this.proj.UTF8ToString(str_ptr);
        return str;
    }

    // return: { compilation_date, major, minor, patch, release, version }
    proj_info() {
        const r = this.proj.proj_info_ems();
        r.compilation_date = this.proj.UTF8ToString(this.proj._get_compilation_date());
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
        if (level === undefined || level === null) level = 4;
        if (level < 0 || level > 4) throw new Error(`Invalid PROJ log level [${level}]`);
        return this.proj._proj_log_level(this.ctx, level);
    }

    /**
     * Equivalent to projinfo CLI https://proj.org/apps/projinfo.html
     * @example
     * projinfo({params: ['EPSG:4326', 'EPSG:32632', '-o', 'proj']})
     * @param {Object} args
     * @param {string[]} [args.params] - Array with the parameters to pass to projinfo
     * @param {boolean} [args.use_network] - Use network configuration. It may change some results
     * @returns {{rc: number, msg: string}} - Return code and message.
     */
    projinfo(args) {
        let msg = '';
        const callback = (_level, message) => {
            msg += message;
        };

        const network_enabled = this.proj._proj_context_is_network_enabled(this.ctx);
        try {
            if (!!args.use_network !== !!network_enabled)
                this.proj._proj_context_set_enable_network(this.ctx, args.use_network);
            const rc = this.proj.projinfo_ems(this.ctx, args.params, callback);
            return { rc: rc, msg: msg };
        } finally {
            if (!!args.use_network !== !!network_enabled)
                this.proj._proj_context_set_enable_network(this.ctx, network_enabled);
        }
    }

    /**
     * @typedef {Object} Axis
     * @property {string} name
     * @property {string} abbr
     * @property {string} direction - north, south, east, west, ...
     * @property {number} conv_factor - conversion to SI, like metre or radian.
     * @property {string} unit - name of the unit, like metre, degree, foot.
     */
    /**
     * Get the axes information.
     * @example
     * crs_axes({crs: 'EPSG:32630+3855'})
     * @param {Object} args
     * @param {string} args.crs - Definition of the CRS
     * @returns {Axis[]} - Axes in an array
     */
    crs_axes(args) {
        if (!args?.crs?.length) {
            throw Error(`args.crs is mandatory.`);
        }
        if (typeof args.crs !== 'string') {
            throw Error(`args.crs must be a string.`);
        }
        const ptr_size = this.ptr_size;
        const double_size = 8; // Doubles are 8 bytes
        const keep = new Keeper(this.proj);
        let res = {};
        try {
            // this function declaration keeps the meaning of "this" from the class
            const internal_axes = (P_crs) => {
                const P_cs = keep.call('_proj_crs_get_coordinate_system', this.ctx, P_crs);
                const axis_count = this.proj._proj_cs_get_axis_count(this.ctx, P_cs);
                const outNamePtr = keep.malloc(ptr_size);
                const outAbbrevPtr = keep.malloc(ptr_size);
                const outDirectionPtr = keep.malloc(ptr_size);
                const outConvFactorPtr = keep.malloc(double_size);
                const outUnitPtr = keep.malloc(ptr_size);
                const res = [];
                for (let i = 0; i < axis_count; i++) {
                    const r = this.proj._proj_cs_get_axis_info(
                        this.ctx,
                        P_cs,
                        i,
                        outNamePtr,
                        outAbbrevPtr,
                        outDirectionPtr,
                        outConvFactorPtr,
                        outUnitPtr,
                        0,
                        0,
                    );
                    if (r !== 1) {
                        throw new Error('error calling proj_cs_get_axis_info');
                    }
                    const d = {
                        name: this._charstarstar_to_string(outNamePtr),
                        abbr: this._charstarstar_to_string(outAbbrevPtr),
                        direction: this._charstarstar_to_string(outDirectionPtr),
                        conv_factor: this.proj.getValue(outConvFactorPtr, 'double'),
                        unit: this._charstarstar_to_string(outUnitPtr),
                    };
                    res.push(d);
                }
                return res;
            };
            const sourceCRS = keep.string(args.crs);
            const P_crs = keep.call('_proj_create', this.ctx, sourceCRS);
            if (this.proj._proj_get_type(P_crs) === Proj.PJ_TYPE_COMPOUND_CRS) {
                const P_crs_0 = keep.call('_proj_crs_get_sub_crs', this.ctx, P_crs, 0);
                const P_crs_1 = keep.call('_proj_crs_get_sub_crs', this.ctx, P_crs, 1);
                res = internal_axes(P_crs_0);
                const res1 = internal_axes(P_crs_1);
                res = res.concat(res1);
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
        if (!args?.source_crs?.length) {
            throw Error(`args.source_crs is mandatory.`);
        }
        if (typeof args.source_crs !== 'string') {
            throw Error(`args.source_crs must be a string.`);
        }
        if (!args?.target_crs?.length) {
            throw Error(`args.target_crs is mandatory.`);
        }
        if (typeof args.target_crs !== 'string') {
            throw Error(`args.target_crs must be a string.`);
        }
        const keep = new Keeper(this.proj);
        try {
            const source_crs = keep.string(args?.source_crs);
            const target_crs = keep.string(args?.target_crs);
            const area = 0;

            let P_src = keep.call('_proj_create', this.ctx, source_crs);
            let P_tgt = keep.call('_proj_create', this.ctx, target_crs);
            if (args?.promote_to_3D) {
                P_src = keep.call('_proj_crs_promote_to_3D', this.ctx, 0, P_src);
                P_tgt = keep.call('_proj_crs_promote_to_3D', this.ctx, 0, P_tgt);
            }
            const process_epoch = (P, epoch, name) => {
                let P_out = P;
                if (epoch !== null && epoch !== undefined && !Number.isNaN(epoch)) {
                    if (typeof epoch !== 'number') {
                        throw new Error(`Epoch ${epoch} must be a float`);
                    }
                    P_out = keep.call('_proj_coordinate_metadata_create', this.ctx, P, epoch);
                    if (P_out === 0) {
                        P_out = P;
                        console.error(`Apparently ${name} is not dynamic. Do not use an epoch.`);
                    }
                }
                return P_out;
            };
            P_src = process_epoch(P_src, args?.source_epoch, args?.source_crs);
            P_tgt = process_epoch(P_tgt, args?.target_epoch, args?.target_crs);

            const ctx = this.proj._proj_context_clone(this.ctx);
            this.proj._proj_context_set_enable_network(ctx, args.use_network);
            // In case of use_network, force "only best", to not provide a wrong result if there is a network problem
            const options_array_ptr = args.use_network ? keep.multi_string_options(['ONLY_BEST=YES']) : 0;
            let P = this.proj._proj_create_crs_to_crs_from_pj(ctx, P_src, P_tgt, area, options_array_ptr);
            if (P === 0) {
                this.proj._proj_destroy(ctx);
                throw new Error('proj_create_crs_to_crs_from_pj returned NULL.');
            }
            if (args.always_xy) {
                const Q = this.proj._proj_normalize_for_visualization(ctx, P);
                this.proj._proj_destroy(P);
                P = Q;
                if (P === 0) {
                    this.proj._proj_destroy(ctx);
                    throw new Error('proj_normalize_for_visualization returned NULL.');
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
        if (!args?.pipeline?.length) {
            throw Error(`args.pipeline is mandatory.`);
        }
        if (typeof args.pipeline !== 'string') {
            throw Error(`args.pipeline must be a string.`);
        }
        const keep = new Keeper(this.proj);
        try {
            const pipeline = keep.string(args?.pipeline);
            const ctx = this.proj._proj_context_clone(this.ctx);
            this.proj._proj_context_set_enable_network(ctx, args.use_network ? 1 : 0);
            const P = this.proj._proj_create(ctx, pipeline);
            if (P === 0) {
                this.proj._proj_destroy(ctx);
                throw new Error('proj_create returned NULL.');
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
     * @param {string} args.crs - Definition of the CRS
     * @returns {crs_metadata_result} the metadata
     */
    crs_metadata(args) {
        if (!args?.crs?.length) {
            throw Error(`args.crs is mandatory.`);
        }
        if (typeof args.crs !== 'string') {
            throw Error(`args.crs must be a string.`);
        }
        const keep = new Keeper(this.proj);
        const res = {};
        try {
            const crs = keep.string(args?.crs);
            const P_crs = keep.call('_proj_create', this.ctx, crs);
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
        if (!args?.crs?.length) {
            throw Error(`args.crs is mandatory.`);
        }
        if (typeof args.crs !== 'string') {
            throw Error(`args.crs must be a string.`);
        }
        const keep = new Keeper(this.proj);
        const res = {};
        try {
            const crs = keep.string(args?.crs);
            const P_crs = keep.call('_proj_create', this.ctx, crs);
            const is_crs = !!this.proj._proj_is_crs(P_crs);
            const P_datum = is_crs ? keep.call('_proj_crs_get_datum_forced', this.ctx, P_crs) : 0;
            res.type = P_datum === 0 ? Proj.PJ_TYPE_UNKNOWN : this.proj._proj_get_type(P_datum);
            res.name = P_datum === 0 ? '' : this.proj.UTF8ToString(this.proj._proj_get_name(P_datum));
            res.is_dynamic =
                res.type === Proj.PJ_TYPE_DYNAMIC_GEODETIC_REFERENCE_FRAME ||
                res.type === Proj.PJ_TYPE_DYNAMIC_VERTICAL_REFERENCE_FRAME;
            return res;
        } finally {
            keep.clean();
        }
    }

    /**
     * List the CRSs from proj.db
     * @param {Object} args
     * @param {number} [args.auth_name] - Authority name. If empty, all authorities are used
     * @returns {Array<{auth: string, code: string, name: string, type: number,
     *            deprecated: boolean, bbox_valid: boolean,
     *            west_lon_degree: number, south_lat_degree: number,
     *            east_lon_degree: number, north_lat_degree: number,
     *            area_name: string, projection_method_name: string, celestial_body_name: string
     *            }>}
     */
    crs_list(args) {
        const keep = new Keeper(this.proj);
        try {
            const auth_name = args?.auth_name ? keep.string(args.auth_name) : 0;
            const params = 0;
            const count_ptr = keep.malloc(4);
            const crs_info_list_ptr = keep.call_destroyer(
                '_proj_get_crs_info_list_from_database',
                '_proj_crs_info_list_destroy',
                this.ctx,
                auth_name,
                params,
                count_ptr,
            );
            const count = this.proj.getValue(count_ptr, 'i32');
            const ppp = [
                ['auth', 'string'],
                ['code', 'string'],
                ['name', 'string'],
                ['type', 'i32'],
                ['deprecated', 'b32'],
                ['bbox_valid', 'b32'],
                ['west_lon_degree', 'double'],
                ['south_lat_degree', 'double'],
                ['east_lon_degree', 'double'],
                ['north_lat_degree', 'double'],
                ['area_name', 'string'],
                ['projection_method_name', 'string'],
                ['celestial_body_name', 'string'],
            ];
            const list = [];
            for (let i = 0; i < count; i++) {
                const info_struct_ptr = this.proj.getValue(crs_info_list_ptr + i * 4, '*');
                const elem = struct_ptr_to_dict(this.proj, info_struct_ptr, ppp);
                list.push(elem);
            }
            return list;
        } finally {
            keep.clean();
        }
    }

    /**
     * Gets the geographic CRS underlying a projected, compound, etc
     * @param {Object} args
     * @param {string} args.crs - definition of the CRS
     * some old PROJ4 expressions need a "+type=crs" to make it clear its nature.
     * @returns {string} - geographic CRS.
     */
    crs_get_geographic(args) {
        if (!args?.crs?.length) {
            throw Error(`args.crs is mandatory.`);
        }
        if (typeof args.crs !== 'string') {
            throw Error(`args.crs must be a string.`);
        }
        const keep = new Keeper(this.proj);
        try {
            const crs = keep.string(args.crs);
            let P_ref = keep.call('_proj_create', this.ctx, crs);
            if (P_ref === 0) {
                throw Error(`cannot create valid object from this: ${args.crs}`);
            }

            let type = this.proj._proj_get_type(P_ref);
            if (type === Proj.PJ_TYPE_GEOCENTRIC_CRS) {
                throw Error(`cannot get geographic from geocentric CRS`);
            } else if (type === Proj.PJ_TYPE_VERTICAL_CRS) {
                throw Error(`cannot get geographic from vertical CRS`);
            } else if (type === Proj.PJ_TYPE_COMPOUND_CRS) {
                P_ref = keep.call('_proj_crs_get_sub_crs', this.ctx, P_ref, 0);
                type = this.proj._proj_get_type(P_ref);
            }

            if (type === Proj.PJ_TYPE_GEOGRAPHIC_2D_CRS || type === Proj.PJ_TYPE_GEOGRAPHIC_3D_CRS) {
                // nothing to do
            } else if (type === Proj.PJ_TYPE_PROJECTED_CRS) {
                P_ref = keep.call('_proj_get_source_crs', this.ctx, P_ref);
            } else if (type === Proj.PJ_TYPE_DERIVED_PROJECTED_CRS) {
                P_ref = keep.call('_proj_get_source_crs', this.ctx, P_ref);
                P_ref = keep.call('_proj_get_source_crs', this.ctx, P_ref);
            } else {
                throw Error(`Unsupported type ${type} to extract the geographic system`);
            }
            const PJ_WKT2_2019 = 2;
            const wkt2 = this.proj._proj_as_wkt(this.ctx, P_ref, PJ_WKT2_2019, 0);
            const out = this.proj.UTF8ToString(wkt2);
            return out;
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
     * @property {number} latitude - degrees
     * @property {number} longitude - degrees
     * @property {number} ellipsoidal_height_m - metres
     * @property {number} error_code - error generated by PROJ. 0 on success.
     * @property {string} [error_msg] - error message when error_code is not 0.
     */
    /**
     * Gets the distortion factors of a projected crs
     * @param {Object} args
     * @param {string} args.crs - definition of the CRS
     * @param {{lat: number, lon: number}[]} args.points - vector of points
     * @returns {factors_result[]} - list of factors
     */
    factors(args) {
        if (!args?.crs?.length) {
            throw Error(`args.crs is mandatory.`);
        }
        if (typeof args.crs !== 'string') {
            throw Error(`args.crs must be a string.`);
        }
        if (!args?.points?.length) {
            throw Error(`args.points is mandatory.`);
        }
        const keep = new Keeper(this.proj);
        try {
            const crs = keep.string(args?.crs);
            const P_crs = keep.call('_proj_create', this.ctx, crs);
            if (P_crs === 0) {
                throw Error(`cannot create valid object from this: ${args.crs}`);
            }

            const P_ellipsoid = keep.call('_proj_get_ellipsoid', this.ctx, P_crs);
            let semi_mayor_m = 0;
            let e2 = 0;
            if (P_ellipsoid) {
                const double_size = 8;
                const out_semi_mayor_m_ptr = keep.malloc(double_size);
                const out_semi_minor_m_ptr = keep.malloc(double_size);
                this.proj._proj_ellipsoid_get_parameters(
                    this.ctx,
                    P_ellipsoid,
                    out_semi_mayor_m_ptr,
                    out_semi_minor_m_ptr,
                    0,
                    0,
                );
                semi_mayor_m = this.proj.getValue(out_semi_mayor_m_ptr, 'double');
                const semi_minor_m = this.proj.getValue(out_semi_minor_m_ptr, 'double');
                e2 = 1 - semi_minor_m ** 2 / semi_mayor_m ** 2;
            }

            const coord_ptr = keep.malloc(32);
            this.proj.setValue(coord_ptr + 8 * 2, 0, 'double'); // z
            this.proj.setValue(coord_ptr + 8 * 3, 0, 'double'); // t

            const factors_ptr = keep.malloc(96);
            const ppp = [
                ['meridional_scale', 'double'],
                ['parallel_scale', 'double'],
                ['areal_scale', 'double'],
                ['angular_distortion', 'double'],
                ['meridian_parallel_angle', 'double'],
                ['meridian_convergence', 'double'],
                ['tissot_semimajor', 'double'],
                ['tissot_semiminor', 'double'],
                ['dx_dlam', 'double'],
                ['dx_dphi', 'double'],
                ['dy_dlam', 'double'],
                ['dy_dphi', 'double'],
            ];
            const res = [];
            for (const point of args.points) {
                if ((point.lat === undefined || point.lon === undefined) && point.length < 2) {
                    throw Error('Invalid input point');
                }
                const lat = point.lat ?? point[0];
                const lon = point.lon ?? point[1];
                const alt = point.alt ?? (point.length >= 3 ? point[2] : 0);
                const lat_rad = this.proj._proj_torad(lat);
                const lon_rad = this.proj._proj_torad(lon);

                this.proj.setValue(coord_ptr + 8 * 0, lon_rad, 'double');
                this.proj.setValue(coord_ptr + 8 * 1, lat_rad, 'double');

                this.proj._proj_errno_reset(P_crs);
                this.proj._proj_factors(factors_ptr, P_crs, coord_ptr);
                const error_code = this.proj._proj_errno(P_crs);
                if (error_code) this.proj._proj_errno_reset(P_crs);

                const elem = struct_ptr_to_dict(this.proj, factors_ptr, ppp);
                for (const key of ['angular_distortion', 'meridian_parallel_angle', 'meridian_convergence']) {
                    elem[key] = this.proj._proj_todeg(elem[key]);
                }
                elem.latitude = lat;
                elem.longitude = lon;
                elem.ellipsoidal_height_m = alt;
                const gaussian_r = semi_mayor_m
                    ? (semi_mayor_m * Math.sqrt(1 - e2)) / (1 - e2 * Math.sin(lat_rad) ** 2)
                    : NaN;
                elem.elevation_factor = gaussian_r / (gaussian_r + alt);
                if (Math.abs(elem.meridional_scale - elem.parallel_scale) < 1e-5) {
                    elem.combined_factor = elem.meridional_scale * elem.elevation_factor;
                }
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

    /**
     * Still in development
     */
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
            const res = [];
            for (const p of args.points) {
                this.proj._geod_direct(geod_geodesic_ptr, p.lat1, p.lon1, p.azi1, p.s12, lat2_ptr, lon2_ptr, azi2_ptr);
                const e = {
                    lat2: this.proj.getValue(lat2_ptr, 'double'),
                    lon2: this.proj.getValue(lon2_ptr, 'double'),
                    azi2: this.proj.getValue(azi2_ptr, 'double'),
                };
                res.push(e);
            }
            return res;
        } finally {
            keep.clean();
        }
    }
}

if (typeof exports === 'object' && typeof module === 'object') {
    module.exports = { Proj: Proj };
}
