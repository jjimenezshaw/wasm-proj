/**
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

const assert = require('node:assert');
const { describe, it, before, after, afterEach } = require('node:test');

const ProjModuleFactory = require('../proj/wasm/projModule.js');
globalThis.ProjModuleFactory = ProjModuleFactory;

const { Proj } = require('../proj/projFunctions.js');
const { WorkerBridge } = require('../proj/projBridge.js');

function similar(a, b, threshold = 1e-6, do_throw = true) {
    const r = Math.abs(a - b) < threshold;
    if (!r && do_throw) {
        throw Error(`Double comparison error.\n  abs(${a} - ${b}) > ${threshold}`);
    }
    return r;
}

function similar_array(a, b, threshold = 1e-6, do_throw = true) {
    if (a.length !== b.length) {
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
            const tr = await proj.create_transformer_from_crs({ source_crs: 'EPSG:4326', target_crs: 'EPSG:32630' });
            for (let i = 0; i < 100; i++) {
                for (let j = 0; j < 100; j++) {
                    const p = [[10 + j * 0.01, 0 + i * 0.01]];
                    const r = await tr.transform({ points: p });
                }
            }
            await tr.dispose();
        });

        await t.test('one big 10000 points simple transform', async (t) => {
            const tr = await proj.create_transformer_from_crs({ source_crs: 'EPSG:4326', target_crs: 'EPSG:32630' });
            const points = [];
            for (let i = 0; i < 100; i++) {
                for (let j = 0; j < 100; j++) {
                    points.push([10 + j * 0.01, 0 + i * 0.01]);
                }
            }
            const r = await tr.transform({ points: points });
            await tr.dispose();
        });
    });
}

describe('basic tests', async (t) => {
    let proj;

    before(async () => {
        proj = new Proj();
        await proj.init();
    });
    after(() => proj.dispose());

    it('proj seems to be loaded', (t) => {
        assert.ok(proj.is_loaded());
        assert.ok(proj.proj);
        assert.ok(typeof proj.proj._get_compilation_date === 'function');
    });

    it('proj_info', (t) => {
        const info = proj.proj_info();
        assert.ok(info.major >= 9);
        if (info.major === 9) {
            assert.ok(info.minor >= 8);
        }
        assert.ok(info.release.includes(info.version));
        assert.ok(info.compilation_date.length === 24); // ISO format
    });

    it('projinfo', async (t) => {
        await t.test('simple WGS84', (t) => {
            const res = proj.projinfo({ params: ['EPSG:4326'] });
            assert.equal(res.rc, 0);
            assert.ok(res.msg.includes('WGS 84'));
        });

        await t.test('WGS84 to UTM32', (t) => {
            const res = proj.projinfo({ params: ['EPSG:4326', 'EPSG:32632'] });
            assert.equal(res.rc, 0);
            assert.ok(res.msg.includes('Candidate operations found: 1'));
            assert.ok(res.msg.includes('EPSG:16032, UTM zone 32N'));
        });
    });

    it('transform', async (t) => {
        await it('transform crs wrong input', async (t) => {
            await assert.rejects(
                async () => {
                    await proj.create_transformer_from_crs();
                },
                { message: /args.source_crs is mandatory/i },
            );
            await assert.rejects(
                async () => {
                    await proj.create_transformer_from_crs({});
                },
                { message: /args.source_crs is mandatory/i },
            );
            await assert.rejects(
                async () => {
                    await proj.create_transformer_from_crs({ source_crs: '' });
                },
                { message: /args.source_crs is mandatory/i },
            );
            await assert.rejects(
                async () => {
                    await proj.create_transformer_from_crs({ source_crs: [9] });
                },
                { message: /args.source_crs must be a string/i },
            );
            await assert.rejects(
                async () => {
                    await proj.create_transformer_from_crs({ source_crs: 'EPSG:4326' });
                },
                { message: /args.target_crs is mandatory/i },
            );
        });
        await it('transform crs', async (t) => {
            const tr = proj.create_transformer_from_crs({ source_crs: 'EPSG:4258', target_crs: 'EPSG:2056' });
            const p = tr.transform({
                points: [
                    [47, 8],
                    [47, 8, 1189],
                ],
            });
            assert.equal(p.length, 2);
            assert.ok(similar_array(p[0], [2642695.4201556733, 1205590.5221826336], 1e-4));
            assert.ok(similar_array(p[1], [2642695.405662641, 1205590.4946125143, 1189], 1e-4));
            tr.dispose();
        });

        await it('transform crs always_xy input', async (t) => {
            const tr = proj.create_transformer_from_crs({
                source_crs: 'EPSG:4258',
                target_crs: 'EPSG:2056',
                always_xy: true,
            });
            const p = tr.transform({ points: [[8, 47]] });
            assert.equal(p.length, 1);
            assert.ok(similar_array(p[0], [2642695.4201556733, 1205590.5221826336], 1e-4));
            tr.dispose();
        });

        await it('transform crs always_xy compare', async (t) => {
            const tr1 = proj.create_transformer_from_crs({
                source_crs: 'EPSG:4258',
                target_crs: 'EPSG:3044',
                always_xy: true,
            });
            const tr2 = proj.create_transformer_from_crs({
                source_crs: 'EPSG:4258',
                target_crs: 'EPSG:25832',
                always_xy: false,
            });
            const tr3 = proj.create_transformer_from_crs({ source_crs: 'EPSG:4258', target_crs: 'EPSG:25832' });
            const p1 = tr1.transform({ points: [[8, 47]] });
            const p2 = tr2.transform({ points: [[47, 8]] });
            const p3 = tr3.transform({ points: [[47, 8]] });
            assert.equal(p1.length, 1);
            assert.ok(similar_array(p1[0], p2[0], 1e-4));
            assert.ok(similar_array(p1[0], p3[0], 1e-4));
            tr1.dispose();
            tr2.dispose();
            tr3.dispose();
        });

        await it('transform invalid coordinate', async (t) => {
            const tr = proj.create_transformer_from_crs({ source_crs: 'EPSG:4258', target_crs: 'EPSG:2056' });
            assert.throws(
                () => {
                    tr.transform({ points: [[147, 8]] });
                },
                { message: /Invalid coordinate/i },
            );
            tr.dispose();
        });

        await it('transform pipeline', async (t) => {
            await it('MGI / Austria GK M34', (t) => {
                // EPSG:31259
                const tr = proj.create_transformer_from_pipeline({
                    pipeline:
                        '+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=750000 +y_0=-5000000 +ellps=bessel +units=m +no_defs',
                });
                // this pipeline is lon-lat in radians.
                const point = [16, 48].map((c) => (c * Math.PI) / 180); // Somewhere near Wien.
                const p = tr.transform({ points: [point] });
                assert.equal(p.length, 1);
                assert.ok(similar_array(p[0], [725127.919986, 317938.999087], 1e-4));
                tr.dispose();
            });

            await it('From WGS84 to MGI / Austria GK M34', (t) => {
                const tr = proj.create_transformer_from_pipeline({
                    pipeline: `+proj=pipeline
                    +step +proj=axisswap +order=2,1
                    +step +proj=unitconvert +xy_in=deg +xy_out=rad
                    +step +proj=push +v_3
                    +step +proj=cart +ellps=WGS84
                    +step +inv +proj=helmert +x=577.326 +y=90.129 +z=463.919 +rx=5.137 +ry=1.474
                            +rz=5.297 +s=2.4232 +convention=position_vector
                    +step +inv +proj=cart +ellps=bessel
                    +step +proj=pop +v_3
                    +step +proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=750000
                            +y_0=-5000000 +ellps=bessel
                    +step +proj=axisswap +order=2,1`,
                });
                // this pipeline is lat-lon in degrees, output in n-e.
                const point = [48, 16]; // Somewhere near Wien.
                const p = tr.transform({ points: [point] });
                assert.equal(p.length, 1);
                assert.ok(similar_array(p[0], [317993.014558, 725213.063933], 1e-4));
                tr.dispose();
            });
        });
    });

    await it('axes', async (t) => {
        await it('2D', async (t) => {
            const axes = await proj.crs_axes({ crs: 'EPSG:4326' });
            const expected = [
                {
                    name: 'Geodetic latitude',
                    abbr: 'Lat',
                    direction: 'north',
                    conv_factor: 0.017453292519943295,
                    unit: 'degree',
                },
                {
                    name: 'Geodetic longitude',
                    abbr: 'Lon',
                    direction: 'east',
                    conv_factor: 0.017453292519943295,
                    unit: 'degree',
                },
            ];
            assert.deepEqual(axes, expected);
        });
        await it('3D', async (t) => {
            const axes = await proj.crs_axes({ crs: 'EPSG:7909' });
            const expected = [
                {
                    name: 'Geodetic latitude',
                    abbr: 'Lat',
                    direction: 'north',
                    conv_factor: 0.017453292519943295,
                    unit: 'degree',
                },
                {
                    name: 'Geodetic longitude',
                    abbr: 'Lon',
                    direction: 'east',
                    conv_factor: 0.017453292519943295,
                    unit: 'degree',
                },
                {
                    name: 'Ellipsoidal height',
                    abbr: 'h',
                    direction: 'up',
                    conv_factor: 1,
                    unit: 'metre',
                },
            ];
            assert.deepEqual(axes, expected);
        });
        await it('compound', async (t) => {
            const axes = await proj.crs_axes({ crs: 'EPSG:6405+8228' });
            const expected = [
                {
                    name: 'Easting',
                    abbr: 'X',
                    direction: 'east',
                    conv_factor: 0.3048,
                    unit: 'foot',
                },
                {
                    name: 'Northing',
                    abbr: 'Y',
                    direction: 'north',
                    conv_factor: 0.3048,
                    unit: 'foot',
                },
                {
                    name: 'Gravity-related height',
                    abbr: 'H',
                    direction: 'up',
                    conv_factor: 0.3048,
                    unit: 'foot',
                },
            ];
            assert.deepEqual(axes, expected);
        });
    });

    await it('crs_list', async (t) => {
        await it('crs_list all', async (t) => {
            const list = await proj.crs_list();
            assert.ok(list.length > 10000);

            assert.equal(list[0].auth, 'EPSG');
            assert.equal(list[0].code, '2000');
            assert.equal(list[0].name, 'Anguilla 1957 / British West Indies Grid');
            assert.equal(list[0].type, 15);
            assert.equal(list[0].projection_method_name, 'Transverse Mercator');
            assert.equal(list[0].celestial_body_name, 'Earth');

            assert.ok(list[1].code !== '2000');
        });

        await it('crs_list epsg', async (t) => {
            const list = await proj.crs_list({ auth_name: 'EPSG' });
            assert.ok(list.length > 7000);
            assert.ok(list.length < 13000);

            assert.equal(list[0].auth, 'EPSG');
            assert.equal(list[0].code, '2000');

            assert.ok(list[1].code !== '2000');
        });

        await it('crs_list none', async (t) => {
            const list = await proj.crs_list({ auth_name: 'foo' });
            assert.equal(list.length, 0);
        });
    });

    it('factors', async (t) => {
        await it('simple', async (t) => {
            const res = proj.factors({
                crs: '+proj=utm +zone=32 +ellps=GRS80',
                points: [{ lat: 0, lon: 9 }],
            });
            assert.ok(similar(res[0].meridional_scale, 0.9996, 1e-8));
            assert.ok(similar(res[0].parallel_scale, 0.9996, 1e-8));
            assert.ok(similar(res[0].angular_distortion, 0, 1e-7));
            assert.ok(similar(res[0].meridian_parallel_angle, 90, 1e-7));
            assert.ok(similar(res[0].areal_scale, 0.99920016, 1e-7));
        });

        await it('error', async (t) => {
            const res = proj.factors({
                crs: 'EPSG:4326',
                points: [{ lat: 0, lon: 9 }],
            });
            assert.ok(similar(res[0].meridional_scale, 0, 1e-8));
            assert.notEqual(0, res[0].error_code);
            assert.ok(res[0].error_msg.includes('Invalid'));
        });

        await it('many', async (t) => {
            const points = [];
            for (let i = 0; i < 100; i++) {
                for (let j = 0; j < 100; j++) {
                    const p = [10 + j * 0.01, 0 + i * 0.01];
                    points.push(p);
                }
            }

            const res = proj.factors({
                crs: '+proj=utm +zone=32 +ellps=GRS80',
                points: points,
            });
            assert.equal(10000, res.length);
            let prev_meridional_scale = -100;
            let prev_meridian_convergence = -100;
            for (const point of res) {
                assert.ok(point.meridional_scale < 10);
                assert.ok(point.meridional_scale > 0.1);
                assert.equal(0, point.error_code);
                assert.notEqual(prev_meridional_scale, point.meridional_scale);
                assert.notEqual(prev_meridian_convergence, point.meridian_convergence);
                prev_meridional_scale = point.meridional_scale;
                prev_meridian_convergence = point.meridian_convergence;
            }
        });
    });

    it('geod_direct', async (t) => {
        await it('one', async (t) => {
            const res = proj.geodesic_direct({
                points: [{ lat1: 40.63972222, lon1: -73.77888889, azi1: 53.5, s12: 5850e3 }],
            });
            assert.ok(similar(res[0].lat2, 49.01466892910852, 0.5e-5));
            assert.ok(similar(res[0].lon2, 2.5610622580828135, 0.5e-5));
            assert.ok(similar(res[0].azi2, 111.62946705267377, 0.5e-5));
        });
        await it('two', async (t) => {
            const res = proj.geodesic_direct({
                points: [
                    { lat1: 40, lon1: -75, azi1: -10, s12: 2e7 },
                    { lat1: 40.63972222, lon1: -73.77888889, azi1: 53.5, s12: 5850e3 },
                ],
            });
            assert.ok(similar(res[0].lat2, -39, 1));
            assert.ok(similar(res[0].lon2, 105, 1));
            assert.ok(similar(res[0].azi2, -170, 1));
            assert.ok(similar(res[1].lat2, 49.01466892910852, 0.5e-5));
            assert.ok(similar(res[1].lon2, 2.5610622580828135, 0.5e-5));
            assert.ok(similar(res[1].azi2, 111.62946705267377, 0.5e-5));
        });
    });

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
        proj = await bridge.create_main_proxy();
        let status = await bridge.get_status();
        assert.equal(status.registry_size, 0);
        await proj.init();
        status = await bridge.get_status();
        assert.equal(status.registry_size, 1);
    });

    afterEach(async (t) => {
        const status = await bridge.get_status();
        assert.ok(status.registry_size <= 1, `Registry is not clean enough after [${t.fullName}]`);
    });

    after(async (t) => {
        await proj.dispose();
        const status = await bridge.get_status();
        bridge.close();
        assert.equal(status.registry_size, 0, 'Was the registry properly cleaned?');
    });

    await it('proj seems to be loaded', async (t) => {
        const loaded = await proj.is_loaded();
        assert.ok(loaded);
    });

    await it('proj_info', async (t) => {
        const info = await proj.proj_info();
        assert.ok(info.major >= 9);
        if (info.major === 9) {
            assert.ok(info.minor >= 8);
        }
        assert.ok(info.release.includes(info.version));
        assert.ok(info.compilation_date.length === 24); // ISO format
    });

    it('transform', async (t) => {
        await t.test('simple', async (t) => {
            const tr = await proj.create_transformer_from_crs({ source_crs: 'EPSG:4258', target_crs: 'EPSG:2056' });
            const p = await tr.transform({
                points: [
                    [47, 8],
                    [47, 8, 1189],
                ],
            });
            assert.equal(p.length, 2);
            assert.ok(similar_array(p[0], [2642695.4201556733, 1205590.5221826336], 1e-4));
            assert.ok(similar_array(p[1], [2642695.405662641, 1205590.4946125143, 1189], 1e-4));
            await tr.dispose();
        });
    });

    it('transform invalid coordinate', async (t) => {
        await t.test('simple', async (t) => {
            const tr = await proj.create_transformer_from_crs({ source_crs: 'EPSG:4258', target_crs: 'EPSG:2056' });
            assert.rejects(
                async () => {
                    await tr.transform({ points: [[147, 8]] });
                },
                { message: /Invalid coordinate/i },
            );
            tr.dispose();
        });
    });

    it('perf', async (t) => {
        await run_performance_transformer(t, proj);
    });

    await it('different timeout that triggers', async (t) => {
        // crs_list is slow.
        assert.rejects(
            async () => {
                await bridge.with_timeout(proj, 10).crs_list();
            },
            { message: /Timeout: crs_list exceeded 10ms/i },
        );
    });
});
