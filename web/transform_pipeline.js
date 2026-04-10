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

function handleFileLoad(event, targetId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const textArea = document.getElementById(targetId);
        textArea.value = e.target.result;

        const prefix = targetId.split('-')[0];
        updateMetadata(prefix);
        validateForm();
    };
    reader.readAsText(file);

    event.target.value = '';
}

function updateURLParams() {
    const params = new URLSearchParams();

    params.set('p', document.getElementById('pipeline-text').value);

    params.set('net', document.getElementById('use-network').checked ? '1' : '');
    params.set('inv', document.getElementById('inverse').checked ? '1' : '');
    params.set('coords', document.getElementById('source-coordinates').value);

    const keysToDelete = [];
    params.forEach((value, key) => {
        if (value === '') keysToDelete.push(key);
    });
    keysToDelete.forEach((key) => {
        params.delete(key);
    });

    const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
}

function loadFromURLParams() {
    const params = new URLSearchParams(window.location.search);

    document.getElementById('pipeline-text').value = params.get('p') ?? '';

    document.getElementById('source-coordinates').value = params.get('coords') ?? '';
    if (params.has('net')) document.getElementById('use-network').checked = params.get('net') === '1';
    if (params.has('inv')) document.getElementById('inverse').checked = params.get('inv') === '1';

    return params.get('run') === '1';
}

function validateForm(doNotUpdateUrl = false) {
    const btn = document.getElementById('btn-transform');
    const coords = document.getElementById('source-coordinates').value.trim();

    const pipeline = document.getElementById('pipeline-text').value;
    const isTextValid = pipeline.trim().length > 0;

    if (coords.length > 0 && isTextValid) {
        btn.disabled = false;
        const prev_log_level = proj.log_level(0); // disable PROJ log messages
        let tr;
        try {
            const dp = document.getElementById(`decimal-places`);
            const inverse = document.getElementById('inverse').checked;
            tr = proj.create_transformer_from_pipeline({ pipeline: pipeline });
            const ang = tr.angular_output({ inverse: inverse });
            const deg = tr.degree_output({ inverse: inverse });
            if (ang || deg) {
                dp.value = 9;
            } else {
                dp.value = 4;
            }
        } catch (_e) {
        } finally {
            proj.log_level(prev_log_level);
            tr?.dispose();
        }
    } else {
        btn.disabled = true;
    }

    if (!doNotUpdateUrl) updateURLParams();
}

function clearField(targetId) {
    const el = document.getElementById(targetId);
    el.value = '';
    el.title = '';

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
}

function parseInputCoordinates(sourceCoords) {
    const coordLines = sourceCoords.split('\n').filter((line) => line.trim().length > 0);
    const points = [];
    coordLines.forEach((line) => {
        let splitted = [];
        for (const separator of [';', ',', '\t', ' ']) {
            splitted = line.split(separator);
            if (splitted.length >= 2) {
                break;
            }
        }
        // replace ',' as decimal separator with ';' column separator
        splitted = splitted.map((e) => e.replace(',', '.'));
        splitted = splitted.filter((n) => n); // remove empty elements
        const floats = splitted.map((e) => Number.parseFloat(e));
        points.push(floats);
    });
    return points;
}

async function handleTransform(proj_worker) {
    const sourceCoords = document.getElementById('source-coordinates').value;

    if (!sourceCoords.trim()) return;

    const output = document.getElementById('target-coordinates');
    output.value = '... computing ...';

    const inverse = document.getElementById('inverse').checked;
    const useNetwork = document.getElementById('use-network').checked;

    const points = parseInputCoordinates(sourceCoords);

    const summaryBox = document.getElementById('transformation-summary');
    const pipeline = document.getElementById('pipeline-text').value;
    summaryBox.innerText = '';
    let transformer;
    try {
        try {
            transformer = await proj_worker.create_transformer_from_pipeline({
                pipeline: pipeline,
                use_network: useNetwork,
            });
        } catch (e) {
            output.value = `Error:${e}`;
            return;
        }
        try {
            const transformed = await transformer.transform({
                points: points,
                inverse: inverse,
            });
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
    }
}

function setupEventListeners(proj_worker) {
    ['inverse', 'use-network'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => validateForm());
    });

    document.getElementById('source-coordinates').addEventListener('input', () => validateForm());

    document.getElementById('pipeline-file').addEventListener('change', (e) => handleFileLoad(e, 'pipeline-text'));
    document.getElementById('coords-file').addEventListener('change', (e) => handleFileLoad(e, 'source-coordinates'));

    document.querySelectorAll('[data-clear]').forEach((btn) => {
        btn.addEventListener('click', function () {
            clearField(this.getAttribute('data-clear'));
        });
    });
    document.querySelectorAll('[data-load]').forEach((btn) => {
        btn.addEventListener('click', function () {
            document.getElementById(this.getAttribute('data-load')).click();
        });
    });
    document.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', function () {
            copyToClipboard(this.getAttribute('data-copy'), this);
        });
    });

    document.getElementById('pipeline-text').addEventListener('input', () => validateForm());
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
        console.log(info);
        document.getElementById('proj-version').innerText = info.version;
        document.getElementById('proj-version').title = info.compilation_date;
        /////////////////////////
        const bridge = new WorkerBridge();
        proj_worker = bridge.create_main_proxy();
        g_proj_worker = proj_worker;

        await proj_worker.init();

        run = loadFromURLParams();

        setupEventListeners(proj_worker);

        validateForm(true);

        console.log('Ready.', Date());
    } catch (e) {
        console.error(e);
        alert(`Problems loading the library. Unexpected behaviour.\n\n${e.message}`);
    } finally {
        loader.classList.add('hidden');
        appContent.classList.remove('loading-state');
    }

    if (run) handleTransform(proj_worker);
}

window.addEventListener('load', load);
