let lastFactors = null;

async function processAllCoordinates(proj_worker) {
    const sourceCoords = document.getElementById('source-coordinates').value;

    if (!sourceCoords.trim()) return;

    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    lastFactors = null;
    document.getElementById('computing').innerText = ' ... Computing ...';
    document.getElementById('computing').classList.remove('required');
    document.getElementById('computing').classList.remove('hidden');
    try {
        let points = parseInputCoordinates(sourceCoords);
        if (points.length === 0) return;
        points = points.map((e) => (e.length === 2 ? [...e, 0] : e));

        function swap(v) {
            const [a, b, ...rest] = v;
            return [b, a, ...rest];
        }

        const orderRadio = document.querySelector('input[name="coord_order"]:checked');
        const isEastingNorthing = orderRadio && orderRadio.value === 'en';
        const isNorthingEasting = orderRadio && orderRadio.value === 'ne';
        let pointsLatLon, pointsEN;
        if (isNorthingEasting) {
            pointsEN = points.map(swap);
        } else if (isEastingNorthing) {
            pointsEN = points;
        } else {
            pointsLatLon = points;
        }

        const useNetwork = document.getElementById('use-network').checked;
        let s = getCrsFromInput('source');
        const metadata = await proj_worker.crs_metadata({ crs: s });
        if (!metadata.is_crs && metadata.type === Proj.PJ_TYPE_OTHER_COORDINATE_OPERATION) {
            s += ' +type=crs'; // let's try if it is an old operation.
        }
        const geographic = await proj_worker.crs_get_geographic({ crs: s });
        let transformer;
        try {
            transformer = await proj_worker.create_transformer_from_crs({
                source_crs: geographic,
                target_crs: s,
                promote_to_3D: true,
                use_network: useNetwork,
                always_xy: true,
            });
            if (pointsEN) {
                pointsLatLon = await transformer.transform({ points: pointsEN, inverse: true }).map(swap);
            } else {
                pointsEN = await transformer.transform({ points: pointsLatLon.map(swap), inverse: false });
            }
        } finally {
            transformer?.dispose();
        }
        const facts = await proj_worker.factors({ crs: s, points: pointsLatLon });

        const labeled = pointsEN.map((e) => ({ easting: e[0], northing: e[1], elevation: e[2] }));

        const factsCompleted = facts.map((entry, i) => ({ ...entry, ...labeled[i] }));
        lastFactors = factsCompleted;
        let easting_u, northing_u, elevation_u;
        function unit_abbr(unit) {
            switch (unit.toLowerCase()) {
                case 'metre':
                case 'meter':
                    return 'm';
                case 'foot':
                    return 'ft';
                case 'us survey foot':
                    return 'ftUS';
            }
            return unit;
        }
        try {
            const axes = await proj_worker.crs_axes({ crs: s });
            [easting_u, northing_u, elevation_u = ''] = axes.map((e) => unit_abbr(e.unit));
        } catch (_) {}

        factsCompleted.forEach((fact, index) => {
            const card = document.createElement('div');
            card.className = 'result-card';

            card.innerHTML = `<div class="card-title">Point ${index + 1}</div>`;
            if (fact.error_code !== 0) {
                card.innerHTML += `<div>Error ${fact.error_code}: ${fact.error_msg}</div>`;
            } else {
                delete fact.error_code;
                card.innerHTML += `
                <div class="card-body">
                    <div class="card-data">
                        ${generateTableHTML(fact, easting_u, northing_u, elevation_u)}
                    </div>
                    <div class="card-visual">
                        <canvas width="250" height="250"></canvas>
                    </div>
                </div>`;
                const canvas = card.querySelector('canvas');
                drawIndicatrix(canvas, fact);
            }
            container.appendChild(card);
        });
        document.getElementById('computing').classList.add('hidden');
        document.getElementById('results-section').classList.remove('hidden');
    } catch (e) {
        document.getElementById('computing').classList.add('required');
        document.getElementById('computing').innerText = e;
    }
}

// Generates a clean HTML table instead of divs
function generateTableHTML(params, easting_u, northing_u, elevation_u) {
    const labels = {
        meridional_scale: 'Meridional Scale (h)',
        parallel_scale: 'Parallel Scale (k)',
        areal_scale: 'Areal Scale (s)',
        angular_distortion: 'Max Angular Distortion (ω) [°]',
        meridian_parallel_angle: 'Meridian-Parallel Angle (θ) [°]',
        meridian_convergence: 'Meridian Convergence (γ) [°]',
        tissot_semimajor: 'Tissot Semi-major Axis (a)',
        tissot_semiminor: 'Tissot Semi-minor Axis (b)',
        dx_dlam: '∂x/∂λ',
        dx_dphi: '∂x/∂φ',
        dy_dlam: '∂y/∂λ',
        dy_dphi: '∂y/∂φ',
        elevation_factor: 'Elevation Scale Factor',
        combined_factor: 'Combined Scale Factor',
        latitude: 'Latitude [°]',
        longitude: 'Longitude [°]',
        ellipsoidal_height_m: 'Ellipsoidal height [m]',
        easting: `Easting${easting_u ? ` [${easting_u}]` : ''}`,
        northing: `Northing${northing_u ? ` [${northing_u}]` : ''}`,
        elevation: `Elevation${elevation_u ? ` [${elevation_u}]` : ''}`,
    };

    const entries = Object.entries(params);
    const leftHalf = entries.slice(0, 12);
    const rightHalf = entries.slice(12);

    function decimals(key) {
        switch (key) {
            case 'easting':
            case 'northing':
            case 'elevation':
            case 'ellipsoidal_height_m':
                return 2;
            case 'latitude':
            case 'longitude':
                return 6;
        }
        return 6;
    }

    const buildRows = (dataGroup) => {
        return dataGroup
            .map(
                ([key, value]) => `
            <tr>
                <th>${labels[key] || key}</th>
                <td>${value.toFixed(decimals(key))}</td>
            </tr>
        `,
            )
            .join('');
    };

    // Return the two tables wrapped in our new responsive flex container
    return `
        <div class="params-flex-container">
            <div class="table-col">
                <table class="params-table"><tbody>${buildRows(leftHalf)}</tbody></table>
            </div>
            <div class="table-col">
                <table class="params-table"><tbody>${buildRows(rightHalf)}</tbody></table>
            </div>
        </div>
    `;
}

function drawIndicatrix(canvas, params) {
    const cos_phi = Math.cos((params.latitude * Math.PI) / 180);
    const m11 = params.dx_dphi ** 2 + params.dx_dlam ** 2 / cos_phi ** 2;
    const m12 = params.dx_dphi * params.dy_dphi + (params.dx_dlam * params.dy_dlam) / cos_phi ** 2;
    const m22 = params.dy_dphi ** 2 + params.dy_dlam ** 2 / cos_phi ** 2;

    let rotation_ellipse = 0.5 * Math.atan2(2 * m12, m11 - m22);
    rotation_ellipse = Math.PI / 2 - rotation_ellipse;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const maxDimension = Math.max(params.tissot_semimajor, params.tissot_semiminor, 1.0);
    const scale = width / 2.5 / maxDimension;

    ctx.save();
    ctx.translate(width / 2, height / 2);

    // horizontal line
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.moveTo(-width / 2, 0);
    ctx.lineTo(width / 2, 0);
    ctx.stroke();
    // vertical line
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.moveTo(0, -height / 2);
    ctx.lineTo(0, height / 2);
    ctx.stroke();

    // unit circle
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.arc(0, 0, 1.0 * scale, 0, 2 * Math.PI);
    ctx.stroke();

    const lineLength = Math.min(height, width) / 2;
    // Parallel
    ctx.save();
    // meridian_parallel_angle has no sign. So compute it
    const parallel_angle = -(Math.atan2(params.dx_dlam, params.dy_dlam) * 180) / Math.PI;
    //ctx.rotate(((90 - params.meridian_convergence + params.meridian_parallel_angle) * Math.PI) / 180);
    ctx.rotate(((90 - parallel_angle) * Math.PI) / 180);
    ctx.beginPath();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    const kLen = params.parallel_scale * scale;
    ctx.moveTo(-kLen, 0);
    ctx.lineTo(kLen, 0);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.moveTo(-lineLength, 0);
    ctx.lineTo(lineLength, 0);
    ctx.stroke();
    ctx.restore();

    // Meridian
    ctx.save();
    ctx.rotate(((90 - params.meridian_convergence) * Math.PI) / 180);
    ctx.beginPath();
    ctx.strokeStyle = 'darkred';
    ctx.lineWidth = 1.5;
    const hLen = params.meridional_scale * scale;
    ctx.moveTo(-hLen, 0);
    ctx.lineTo(hLen, 0);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.moveTo(-lineLength, 0);
    ctx.lineTo(lineLength, 0);
    ctx.stroke();
    ctx.restore();

    // ellipse
    ctx.save();
    ctx.rotate(0);
    ctx.beginPath();
    ctx.strokeStyle = '#f97316';
    ctx.fillStyle = 'rgba(249, 115, 22, 0.2)';
    ctx.lineWidth = 2;
    ctx.ellipse(
        0,
        0,
        params.tissot_semiminor * scale,
        params.tissot_semimajor * scale,
        rotation_ellipse,
        0,
        2 * Math.PI,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
}

function setupEventListenersFactors(proj_worker, proj, crs_list) {
    document.getElementById('btn-copy-json').addEventListener('click', (e) => {
        const text = JSON.stringify(lastFactors, null, 4);
        navigator.clipboard.writeText(text).then(() => {
            const btn = e.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => (btn.textContent = originalText), 2000);
        });
    });
    document.getElementById('btn-transform').addEventListener('click', async () => processAllCoordinates(proj_worker));
}

/**
 * "Backdoor" to enable PROJ debug messages (as errors) in the console
 * @param {number} level
 * @returns
 */
async function _proj_set_log_level(level) {
    console.log(proj.log_level(level), await g_proj_worker.log_level(level));
    return true;
}

let proj;
let g_proj_worker; // just for debug function proj_set_log_level

async function load() {
    const appContent = document.getElementById('app-content');
    const loader = document.getElementById('loading-indicator');
    loader.classList.remove('hidden');

    console.log('Downloading resources...', Date());
    let proj_worker;
    let run;
    try {
        proj = new Proj();
        await proj.init();
        const info = proj.proj_info();
        console.log(info);
        document.getElementById('proj-version').innerText = info.version;
        document.getElementById('proj-version').title = info.compilation_date;
        const crs_list = get_crs_list();
        /////////////////////////
        const bridge = new WorkerBridge();
        proj_worker = bridge.create_main_proxy();
        g_proj_worker = proj_worker;
        await proj_worker.init();

        setupComboboxes(crs_list, true);

        run = await loadFromURLParams(crs_list);
        updateAfterLoadUrl(crs_list);

        setupEventListeners(proj_worker, proj, crs_list, true);
        setupEventListenersFactors(proj_worker, proj, crs_list);

        console.log('Ready.', Date());
    } catch (e) {
        console.error(e);
        alert(`Problems loading the library. Unexpected behaviour.\n\n${e.message}`);
    } finally {
        loader.classList.add('hidden');
        appContent.classList.remove('loading-state');
    }
    if (run && proj_worker) processAllCoordinates(proj_worker);
}

window.addEventListener('load', load);
