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

async function handleTransform(proj_worker) {
    let transformer;
    try {
        try {
            const pipeline = document.getElementById('pipeline-text').value;
            const useNetwork = document.getElementById('use-network').checked;
            transformer = await proj_worker.create_transformer_from_pipeline({
                pipeline: pipeline,
                use_network: useNetwork,
            });
        } catch (e) {
            output.value = `Error:${e}`;
            return;
        }
        await handleTransformCommon(transformer);
    } finally {
        await transformer?.dispose();
    }
}

function setupEventListeners(proj_worker) {
    ['inverse', 'use-network', 'coord-separator', 'first-column-is-id'].forEach((id) => {
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
        console.log('proj_info', info);
        console.log('database_metadata', proj.database_metadata());
        document.getElementById('proj-version').innerText = info.version;
        document.getElementById('proj-version').title = dictionaryToString(info, '\n');
        /////////////////////////
        const bridge = new WorkerBridge();
        proj_worker = bridge.create_main_proxy();
        g_proj_worker = proj_worker;

        await proj_worker.init();

        run = await loadFromURLParams();

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
