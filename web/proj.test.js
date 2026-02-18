const assert = require("node:assert");
const { describe, it, before, after, afterEach } = require('node:test');

const ProjModuleFactory = require("./projModule.js");
globalThis.ProjModuleFactory = ProjModuleFactory;

const { Proj } = require("./projFunctions.js")
const { WorkerBridge } = require('./projBridge.js');

function similar(a, b, threshold = 1e-6, do_throw = true) {
    const r = Math.abs(a - b) < threshold;
    if (!r && do_throw) {
        throw Error(`Double comparison error.\n  abs(${a} - ${b}) > ${threshold}`);
    }
    return r;
};

function similar_array(a, b, threshold = 1e-6, do_throw = true) {
    if (a.length != b.length) {
        if (do_throw) {
            throw Error(`Arrays size differ.\n  ${a.length} != ${b.length}`);
        }
        return false;
    }
    let r = true;
    for (let i = 0; i < a.length; i++) {
        try {
            r = r && similar(a[i], b[i], threshold, do_throw);
        } catch (e) {
            throw Error(`Error in position ${i} of length ${a.length}\n${e}`);
        }
    }
    return r;
}

async function run_performance_transformer(t, proj) {
    await t.test('performance_transformer', async (t) => {
        await t.test('10000 simple transforms', async (t) => {
            const tr = await proj.create_transformer_from_crs_to_crs({ source_crs: "EPSG:4326", target_crs: "EPSG:32630" });
            for (let i = 0; i < 100; i++) {
                for (let j = 0; j < 100; j++) {
                    const p = [[10 + j * 0.01, 0 + i * 0.01]]
                    const r = await tr.transform({ points: p });
                }
            }
            await tr.dispose();
        })

        await t.test('one big 10000 points simple transform', async (t) => {
            const tr = await proj.create_transformer_from_crs_to_crs({ source_crs: "EPSG:4326", target_crs: "EPSG:32630" });
            let points = [];
            for (let i = 0; i < 100; i++) {
                for (let j = 0; j < 100; j++) {
                    points.push([10 + j * 0.01, 0 + i * 0.01]);
                }
            }
            const r = await tr.transform({ points: points });
            await tr.dispose();
        })
    })
}

describe('basic tests', async (t) => {
    let proj;

    before(async () => {
        proj = new Proj();
        await proj.init();
    }
    );
    after(() => proj.dispose());

    it('proj seems to be loaded', (t) => {
        assert.ok(proj.is_loaded());
        assert.ok(proj.proj);
        assert.ok(typeof proj.proj._get_compilation_date === 'function');
    });

    it('proj_info', (t) => {
        const info = proj.proj_info();
        assert.ok(info.major >= 9);
        if (info.major == 9) {
            assert.ok(info.minor >= 8)
        }
        assert.ok(info.release.includes(info.version));
        assert.ok(info.compilation_date.length == 24); // ISO format
    });

    it('projinfo', async (t) => {
        await t.test('simple WGS84', (t) => {
            const res = proj.projinfo({ args: ["EPSG:4326"] });
            assert.equal(res.rc, 0);
            assert.ok(res.msg.includes("WGS 84"));
        });

        await t.test('WGS84 to UTM32', (t) => {
            const res = proj.projinfo({ args: ["EPSG:4326", "EPSG:32632"] });
            assert.equal(res.rc, 0);
            assert.ok(res.msg.includes("Candidate operations found: 1"));
            assert.ok(res.msg.includes("EPSG:16032, UTM zone 32N"));
        });
    });

    it('transform', async (t) => {
        await t.test('simple', (t) => {
            const tr = proj.create_transformer_from_crs_to_crs({ source_crs: "EPSG:4258", target_crs: "EPSG:2056" });
            let p = tr.transform({ points: [[47, 8], [47, 8, 1189]] });
            assert.equal(p.length, 2);
            assert.ok(similar_array(p[0], [2642695.4201556733, 1205590.5221826336], 1e-4))
            assert.ok(similar_array(p[1], [2642695.405662641, 1205590.4946125143, 1189], 1e-4))
            tr.dispose();
        })
    })

    it('perf', async (t) => {
        await run_performance_transformer(t, proj);
    });

});

describe('worker', async (t) => {
    let proj;
    let bridge;

    before(async () => {
        bridge = new WorkerBridge();
        // Create the entry point proxy
        proj = await bridge.create_proxy('root');
        // We attach the ID manually so our 'with_timeout' helper works
        proj._object_id = 'root';
        let status = await bridge.get_status();
        assert.equal(status.registry_size, 0);
        await proj.init();
        status = await bridge.get_status();
        assert.equal(status.registry_size, 1);
    });

    afterEach(async (t) => {
        let status = await bridge.get_status();
        assert.ok(status.registry_size <= 1, `Registry is not clean enough after [${t.fullName}]`);
    });

    after(async (t) => {
        await proj.dispose();
        let status = await bridge.get_status();
        bridge.close();
        assert.equal(status.registry_size, 0, "Was the registry properly cleaned?");
    });

    await it('proj seems to be loaded', async (t) => {
        const loaded = await proj.is_loaded();
        assert.ok(loaded);
    });

    await it('proj_info', async (t) => {
        const info = await proj.proj_info();
        assert.ok(info.major >= 9);
        if (info.major == 9) {
            assert.ok(info.minor >= 8)
        }
        assert.ok(info.release.includes(info.version));
        assert.ok(info.compilation_date.length == 24); // ISO format
    });

    it('transform', async (t) => {
        await t.test('simple', async (t) => {
            const tr = await proj.create_transformer_from_crs_to_crs({ source_crs: "EPSG:4258", target_crs: "EPSG:2056" });
            let p = await tr.transform({ points: [[47, 8], [47, 8, 1189]] });
            assert.equal(p.length, 2);
            assert.ok(similar_array(p[0], [2642695.4201556733, 1205590.5221826336], 1e-4))
            assert.ok(similar_array(p[1], [2642695.405662641, 1205590.4946125143, 1189], 1e-4))
            await tr.dispose();
        })
    })

    it('perf', async (t) => {
        await run_performance_transformer(t, proj);
    });
})
