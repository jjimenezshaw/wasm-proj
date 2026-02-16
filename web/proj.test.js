const assert = require("node:assert");
const { describe, it, before, after } = require('node:test');

const ProjModuleFactory = require("./projModule.js");
globalThis.ProjModuleFactory = ProjModuleFactory;

const { Proj } = require("./projFunctions.js")

function similar(a, b, threshold = 1e-6, do_throw = true) {
    const r = Math.abs(a - b) < threshold;
    if (!r && do_throw) {
        throw Error("Double comparison error.\n  abs(" + a + " - " + b + ") > " + threshold);
    }
    return r;
};

function similar_array(a, b, threshold = 1e-6, do_throw = true) {
    if (a.length != b.length) {
        if (do_throw) {
            throw Error("Arrays size differ.\n  " + a.length + " != " + b.length);
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

describe('tests', async (t) => {
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

});
