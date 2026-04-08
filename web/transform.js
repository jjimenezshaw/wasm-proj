/*
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

async function copyToClipboard(targetId, btnElement) {
    const element = document.getElementById(targetId);
    const textToCopy = element.value !== undefined ? element.value : element.innerText;
    if (!textToCopy.trim()) return;

    try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btnElement.innerText;
        btnElement.innerText = 'Copied!';
        btnElement.classList.add('btn-copied');

        setTimeout(() => {
            btnElement.innerText = originalText;
            btnElement.classList.remove('btn-copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        alert('Could not copy to clipboard. Please check browser permissions.');
    }
}

async function swapSourceTarget(crs_list) {
    updateURLParams();

    const params = new URLSearchParams(window.location.search);
    const newParams = new URLSearchParams();

    // Loop through parameters and swap the 's' and 't' prefixes
    params.forEach((value, key) => {
        // This Regex matches our specific keys: st, tt, sh, th, sv, tv, sf, tf, se, te
        if (key.match(/^[st][thfve]$/)) {
            const newPrefix = key.charAt(0) === 's' ? 't' : 's';
            newParams.set(newPrefix + key.substring(1), value);
        } else if (key !== 'coords') {
            // Keep the non-directional settings like p3d, net
            newParams.set(key, value);
        }
    });

    // Move the transformed output into the input box!
    const targetCoords = document.getElementById('target-coordinates').value.toLowerCase();
    document.getElementById('target-coordinates').value = '';
    document.getElementById('transformation-summary').innerText = '';
    if (targetCoords && !targetCoords.includes('computing') && !targetCoords.includes('error')) {
        newParams.set('coords', targetCoords);
    } else {
        // If there's no valid output, just keep the original input coords
        newParams.set('coords', params.get('coords') || '');
    }

    await loadFromURLParams(crs_list, newParams);
    updateAfterLoadUrl(crs_list);
    validateForm();
}

function setEpochEnabled(prefix, isEnabled) {
    const container = document.getElementById(`${prefix}-epoch-container`);
    const input = document.getElementById(`${prefix}-epoch`);
    const helper = container.querySelector('.helper-text');

    if (isEnabled) {
        container.classList.remove('disabled');
        input.disabled = false;
        helper.classList.add('hidden');
    } else {
        container.classList.add('disabled');
        input.disabled = true;
        helper.classList.remove('hidden');
        input.value = '';
    }

    // validateForm();
}

function showPointsInMap(proj) {
    const coords = document.getElementById('source-coordinates').value;
    if (!coords.trim()) {
        console.log('No points to show in the map.');
        return;
    }

    const points = parseInputCoordinates(coords).map((e) => e.slice(0, 2));

    let transformer;
    try {
        const s = getCrsFromInput('source');
        if (s.length === 0) throw new Error('Select a valid source CRS');
        const t = 'EPSG:4326';
        transformer = proj.create_transformer_from_crs({
            source_crs: s,
            target_crs: t,
            promote_to_3D: false,
        });
        const transformed = transformer.transform({ points: points });
        const res = transformed.map((point) => point.map((e) => e.toFixed(6)).join(',')).join(';');
        const mapUrl = `./pointsinmap.html?points=${res}`;
        window.open(mapUrl, '_blank');
    } catch (e) {
        console.error(`Error showing in a map: ${e}`);
        return;
    } finally {
        if (transformer) transformer.dispose();
    }
}

async function handleTransform(proj_worker) {
    const sourceCoords = document.getElementById('source-coordinates').value;

    if (!sourceCoords.trim()) return;

    const output = document.getElementById('target-coordinates');
    output.value = '... computing ...';
    console.time('transformation');

    const promote3D = document.getElementById('promote-3d').checked;
    const useNetwork = document.getElementById('use-network').checked;

    const points = parseInputCoordinates(sourceCoords);

    const summaryBox = document.getElementById('transformation-summary');
    summaryBox.innerText = '';
    let transformer;
    try {
        try {
            const s = getCrsFromInput('source');
            const t = getCrsFromInput('target');
            transformer = await proj_worker.create_transformer_from_crs({
                source_crs: s,
                target_crs: t,
                source_epoch: parseFloat(document.getElementById('source-epoch').value),
                target_epoch: parseFloat(document.getElementById('target-epoch').value),
                use_network: useNetwork,
                promote_to_3D: promote3D,
            });
        } catch (e) {
            output.value = `Error:${e}`;
            return;
        }
        try {
            const transformed = await transformer.transform({ points: points });
            const dp = document.getElementById(`decimal-places`).value;

            const res = transformed
                .map((point) => point.map((e, index) => e.toFixed(index < 2 ? dp : 4)).join(' '))
                .join('\n');
            output.value = res;
        } catch (e) {
            output.value = `Error:${e}`;
            return;
        }
        try {
            const lastOp = await transformer.get_last_operation();
            const date = new Date().toLocaleString();
            summaryBox.innerText = `${lastOp.description}\n\n${lastOp.proj_5}\n\n${date}`;
        } catch (e) {
            summaryBox.innerText = `Error: ${e}`;
        }
    } finally {
        if (transformer) await transformer.dispose();
        console.timeEnd('transformation');
    }
}

function setupEventListenersTransform(proj_worker, proj, crs_list) {
    document.getElementById('btn-transform').addEventListener('click', () => handleTransform(proj_worker));
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
        console.log('proj_info', info);
        console.log('database_metadata', proj.database_metadata());
        document.getElementById('proj-version').innerText = info.version;
        document.getElementById('proj-version').title = info.compilation_date;
        const crs_list = get_crs_list();
        /////////////////////////
        const bridge = new WorkerBridge();
        proj_worker = bridge.create_main_proxy();
        g_proj_worker = proj_worker;
        await proj_worker.init();

        setupComboboxes(crs_list);

        run = await loadFromURLParams(crs_list);
        updateAfterLoadUrl(crs_list);

        setupEventListeners(proj_worker, proj, crs_list);
        setupEventListenersTransform(proj_worker, proj, crs_list);

        console.log('Ready.', Date());
    } catch (e) {
        console.error(e);
        alert(`Problems loading the library. Unexpected behaviour.\n\n${e.message}`);
    } finally {
        loader.classList.add('hidden');
        appContent.classList.remove('loading-state');
    }
    if (run && proj_worker) handleTransform(proj_worker);
}

window.addEventListener('load', load);
