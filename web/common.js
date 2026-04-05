/*
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

// Safari cannot change the display in options in select. So do a heavier work.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

function getCrsAuthCode(descriptor) {
    // anything before the space is auth:code.
    const match = (descriptor ?? '').match(/([A-Z0-9_-]*):([.A-Z0-9_-]*)( .*|$)/i);
    if (match) {
        return [match[1], match[2]];
    }
    return ['', ''];
}

function getCrsId(descriptor) {
    const pair = getCrsAuthCode(descriptor);
    if (pair[0]) {
        return `${pair[0]}:${pair[1]}`;
    }
    return '';
}

function findInCrsList(authCode, crs_list) {
    if (authCode.length < 2) return null;
    const ac = authCode.map((e) => e.toLowerCase());
    const inList = crs_list.find((e) => e.auth.toLowerCase() === ac[0] && e.code.toLowerCase() === ac[1]);
    return inList;
}

function clearField(targetId) {
    const el = document.getElementById(targetId);
    el.value = '';
    el.title = '';
    el.innerText = '';

    // Dispatch an input event so your validation, metadata, and URL updating functions run automatically
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // The ideas was to keep the user's cursor in the box
    // but Chrome is taking a long time... let's do it for now.
    el.focus();
}

function parseInputCoordinates(sourceCoords) {
    const coordLines = sourceCoords.split('\n').filter((line) => line.trim().length > 0);
    const points = [];
    coordLines.forEach((line) => {
        if (line[0] === '#') {
            return;
        }
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

function getCrsFromInput(prefix) {
    const selectedType = document.querySelector(`input[name="${prefix}_type"]:checked`).value;
    let crs = '';
    if (selectedType === 'combo') {
        const horiz = getCrsId(document.getElementById(`${prefix}-horizontal-input`).value);
        const vert = getCrsId(document.getElementById(`${prefix}-vertical-input`).value);
        if (horiz) {
            crs = horiz;
            if (vert) crs += `+${vert}`;
        }
    } else {
        crs = document.getElementById(`${prefix}-freetext`).value;
    }
    return crs;
}

function populateSelect(selectElement, dataArray, filter) {
    selectElement.innerHTML = '';
    const fragment = document.createDocumentFragment();
    dataArray.forEach((item) => {
        if (!filter || filter(item)) {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            option.title = item;
            fragment.appendChild(option);
        }
    });
    selectElement.appendChild(fragment);
    //selectElement.selectedIndex = -1;
}

function updateMetadata(prefix) {
    const metadataBox = document.getElementById(`${prefix}-metadata`);
    const crs = getCrsFromInput(prefix);

    let metadataText = '';

    const prev_log_level = proj.log_level(0); // disable PROJ log messages
    try {
        const metadata = crs ? proj.crs_metadata({ crs: crs }) : {};
        if (metadata.is_crs) {
            const datum = proj.datum_metadata({ crs: crs });
            if (typeof setEpochEnabled === 'function') setEpochEnabled(prefix, datum.is_dynamic);

            const a = proj.crs_axes({ crs: crs });
            metadataText = a.map((e) => `${e.name} (${e.abbr})  |  ${e.direction}  -  [${e.unit}]`).join('\n');
            if (a.length === 0) {
                metadataText = `Cannot get data from '${crs}'`;
            } else if (prefix === 'target') {
                const axUnit = a[0].unit.toLowerCase();
                const dp = document.getElementById(`decimal-places`);
                if (axUnit.includes('degree') || axUnit.includes('rad')) {
                    dp.value = 9;
                } else {
                    dp.value = 4;
                }
            }
        } else {
            if (typeof setEpochEnabled === 'function') setEpochEnabled(prefix, false);
        }
    } finally {
        proj.log_level(prev_log_level);
    }

    metadataBox.value = metadataText;
}

function updateCRSLink(prefix, type, value) {
    const linkElement = document.getElementById(`${prefix}-${type}-link`);
    if (!linkElement) return;

    if (value) {
        const pair = getCrsAuthCode(value);

        if (pair[0]) {
            const auth = pair[0];
            const code = pair[1];
            linkElement.href = `https://spatialreference.org/ref/${auth.toLowerCase()}/${code}/`;
            linkElement.classList.remove('disabled');
            linkElement.title = `View ${auth}:${code} details`;
        } else {
            linkElement.href = '#';
            linkElement.classList.add('disabled');
            linkElement.title = 'No external link available';
        }
    } else {
        linkElement.href = '#';
        linkElement.classList.add('disabled');
        linkElement.title = 'Select a CRS to view details';
    }
}

function validateForm(doNotUpdateUrl = false) {
    const btn = document.getElementById('btn-transform');
    const coords = document.getElementById('source-coordinates').value.trim();

    function checkColumnValidity(prefix) {
        if (!document.querySelector(`input[name="${prefix}_type"]`)) {
            return true; //if it is not defined, go ahead
        }
        const mode = document.querySelector(`input[name="${prefix}_type"]:checked`).value;
        if (mode === 'combo') {
            return document.getElementById(`${prefix}-horizontal-input`).value.trim().length > 0;
        } else {
            return document.getElementById(`${prefix}-freetext`).value.trim().length > 0;
        }
    }

    const isSourceValid = checkColumnValidity('source');
    const isTargetValid = checkColumnValidity('target');

    if (coords.length > 0 && isSourceValid && isTargetValid) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }

    if (!doNotUpdateUrl) updateURLParams();
}

// prefix: source, target
// type: horizontal, vertical
function setupCustomCombobox(prefix, type, only_projected_horizontal) {
    const container = document.getElementById(`${prefix}-${type}-container`);
    if (!container) return;
    const input = document.getElementById(`${prefix}-${type}-input`);
    const select = document.getElementById(`${prefix}-${type}-select`);
    select.selectedIndex = -1;

    input.addEventListener('focus', () => container.classList.add('open'));
    input.addEventListener('click', () => container.classList.add('open'));

    container.addEventListener('focusout', (e) => {
        const authCode = getCrsAuthCode(e.target.value);
        if (authCode[0] && !findInCrsList(authCode, g_crs_list)) {
            input.classList.add('invalid');
            input.title = 'Element not in the catalog.';
        } else {
            input.classList.remove('invalid');
            input.title = '';
        }
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('open');
        }
    });

    function handleSelection(val) {
        val = val.replace(/ \{.{1,2}\}$/, '');
        input.value = val;
        input.title = val;
        container.classList.remove('open');
        // The ideas was to keep the user's cursor in the box
        // but Chrome is taking a long time... and it is not worth it. Just press <tab>
        // input.focus();

        updateMetadata(prefix);
        updateCRSLink(prefix, type, val);
        if (type === 'horizontal' && typeof manageVertical === 'function') manageVertical(prefix, g_crs_list);
        validateForm();
    }

    select.addEventListener('change', function () {
        if (this.value) handleSelection(this.value);
    });

    select.addEventListener('click', (e) => {
        if (e.target.tagName === 'OPTION' || e.target.tagName === 'SELECT') {
            if (select.value) handleSelection(select.value);
        }
    });

    // apparently redundant with 'focusout', but needed in some browsers that do not trigger it on the void
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) container.classList.remove('open');
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!container.classList.contains('open')) container.classList.add('open');

            const direction = e.key === 'ArrowDown' ? 1 : -1;
            const options = select.options;
            const currentIndex = select.selectedIndex;
            let nextIndex = -1;

            if (direction === 1) {
                const start = currentIndex >= 0 ? currentIndex + 1 : 0;
                for (let i = start; i < options.length; i++) {
                    if (!options[i].classList.contains('hidden')) {
                        nextIndex = i;
                        break;
                    }
                }
            } else {
                const start = currentIndex >= 0 ? currentIndex - 1 : options.length - 1;
                for (let i = start; i >= 0; i--) {
                    if (!options[i].classList.contains('hidden')) {
                        nextIndex = i;
                        break;
                    }
                }
            }

            if (nextIndex !== -1) select.selectedIndex = nextIndex;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (container.classList.contains('open') && select.selectedIndex !== -1) {
                handleSelection(select.options[select.selectedIndex].value);
            }
        } else if (e.key === 'Escape') {
            container.classList.remove('open');
        }
    });

    input.addEventListener('input', (e) => {
        container.classList.add('open');
        const inputText = e.target.value;
        select.selectedIndex = -1;

        updateCRSLink(prefix, type, inputText);
        updateMetadata(prefix);

        // many people write WGS84
        const filterArray = inputText.toLowerCase().replace('wgs84', 'wgs 84').split(' ');

        function filter(text) {
            const lower = text.toLowerCase();
            return filterArray.every((e) => lower.includes(e));
        }

        if (isSafari) {
            const [horizontalData, verticalData] = getDataLists(g_crs_list, only_projected_horizontal);
            const data = type === 'horizontal' ? horizontalData : verticalData;
            select.innerHTML = '';
            populateSelect(select, data, (t) => filter(t));
        } else {
            const options = select.options;
            for (let i = 0; i < options.length; i++) {
                options[i].classList.toggle('hidden', !filter(options[i].textContent));
            }
        }
    });
}

function setupComboboxes(crs_list, only_projected_horizontal) {
    setupCustomCombobox('source', 'horizontal', only_projected_horizontal);
    setupCustomCombobox('source', 'vertical', only_projected_horizontal);
    setupCustomCombobox('target', 'horizontal', only_projected_horizontal);
    setupCustomCombobox('target', 'vertical', only_projected_horizontal);

    updateComboboxes(crs_list, only_projected_horizontal);
}

function updateComboboxSelect(select, dataArray) {
    select.innerHTML = '';
    populateSelect(select, dataArray);
}

function updateCombobox(prefix, type, dataArray) {
    const select = document.getElementById(`${prefix}-${type}-select`);
    if (!select) return;
    updateComboboxSelect(select, dataArray);
}

function updateComboboxes(crs_list, only_projected_horizontal) {
    const [horizontalData, verticalData] = getDataLists(crs_list, only_projected_horizontal);
    updateCombobox('source', 'horizontal', horizontalData, crs_list);
    updateCombobox('source', 'vertical', verticalData, crs_list);
    updateCombobox('target', 'horizontal', horizontalData, crs_list);
    updateCombobox('target', 'vertical', verticalData, crs_list);
}

function toggleInputs(columnPrefix, doNotUpdateUrl = false) {
    if (!document.querySelector(`input[name="${columnPrefix}_type"]:checked`)) {
        return;
    }

    const selectedType = document.querySelector(`input[name="${columnPrefix}_type"]:checked`).value;
    const comboGroup = document.getElementById(`${columnPrefix}-combo-group`);
    const textGroup = document.getElementById(`${columnPrefix}-text-group`);

    if (selectedType === 'combo') {
        comboGroup.classList.remove('hidden');
        textGroup.classList.add('hidden');
        document.getElementById(`${columnPrefix}-freetext`).value = '';
    } else {
        comboGroup.classList.add('hidden');
        textGroup.classList.remove('hidden');
        document.getElementById(`${columnPrefix}-horizontal-input`).value = '';
        document.getElementById(`${columnPrefix}-vertical-input`).value = '';

        updateCRSLink(columnPrefix, 'horizontal', '');
        updateCRSLink(columnPrefix, 'vertical', '');
    }
    updateMetadata(columnPrefix);
    validateForm(doNotUpdateUrl);
}

function setupEventListeners(proj_worker, proj, crs_list, only_projected_horizontal) {
    // 1. Checkboxes & simple inputs
    ['promote-3d', 'use-network'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => validateForm());
    });
    document.getElementById('show-deprecated').addEventListener('change', () => {
        updateComboboxes(crs_list, only_projected_horizontal);
        updateURLParams();
    });

    [
        'source-horizontal-input',
        'source-vertical-input',
        'source-epoch',
        'target-horizontal-input',
        'target-vertical-input',
        'target-epoch',
        'source-coordinates',
    ].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', () => validateForm());
    });

    // 2. Radio buttons
    document.querySelectorAll('input[name="source_type"]')?.forEach((radio) => {
        radio.addEventListener('change', () => toggleInputs('source'));
    });
    document.querySelectorAll('input[name="target_type"]')?.forEach((radio) => {
        radio.addEventListener('change', () => toggleInputs('target'));
    });
    document.querySelectorAll('input[name="coord_order"]')?.forEach((radio) => {
        radio.addEventListener('change', () => validateForm());
    });

    // 3. Freetext areas (Need metadata update + validation)
    ['source', 'target'].forEach((prefix) => {
        document.getElementById(`${prefix}-freetext`)?.addEventListener('input', () => {
            updateMetadata(prefix);
            validateForm();
        });
    });

    // 4. File inputs
    document.getElementById('source-file')?.addEventListener('change', (e) => handleFileLoad(e, 'source-freetext'));
    document.getElementById('target-file')?.addEventListener('change', (e) => handleFileLoad(e, 'target-freetext'));
    document.getElementById('coords-file')?.addEventListener('change', (e) => handleFileLoad(e, 'source-coordinates'));

    // 5. Data-Attribute Buttons (Clear, Load, Copy)
    document.querySelectorAll('[data-clear]')?.forEach((btn) => {
        btn.addEventListener('click', function () {
            clearField(this.getAttribute('data-clear'));
        });
    });
    document.querySelectorAll('[data-load]')?.forEach((btn) => {
        btn.addEventListener('click', function () {
            document.getElementById(this.getAttribute('data-load')).click();
        });
    });
    document.querySelectorAll('[data-copy]')?.forEach((btn) => {
        btn.addEventListener('click', function () {
            copyToClipboard(this.getAttribute('data-copy'), this);
        });
    });
    document.querySelectorAll('[data-swap]')?.forEach((btn) => {
        btn.addEventListener('click', async () => swapSourceTarget(crs_list));
    });

    // 6. Main Action Buttons
    document.getElementById('points-in-map').addEventListener('click', () => showPointsInMap(proj));

    // Diagram Toggle
    document.getElementById('toggle-diagrams')?.addEventListener('change', (e) => {
        const resultsSection = document.getElementById('results-section');
        resultsSection.classList.toggle('hide-diagrams', !e.target.checked);
    });

    setupAdvancedOptions(proj, proj_worker, () => {
        updateComboboxes(get_crs_list(), only_projected_horizontal);
    });
}

function getDataLists(crs_list, only_projected_horizontal) {
    const horizontalData = [];
    const verticalData = [' - none / ellipsodial height'];
    const PJ_TYPE_GEOCENTRIC_CRS = 10;
    const PJ_TYPE_GEOGRAPHIC_2D_CRS = 12;
    const PJ_TYPE_GEOGRAPHIC_3D_CRS = 13;
    const PJ_TYPE_VERTICAL_CRS = 14;
    const PJ_TYPE_PROJECTED_CRS = 15;
    const PJ_TYPE_COMPOUND_CRS = 16;
    function typeToStr(type) {
        switch (type) {
            case PJ_TYPE_GEOCENTRIC_CRS:
                return 'GC';
            case PJ_TYPE_GEOGRAPHIC_2D_CRS:
                return '2D';
            case PJ_TYPE_GEOGRAPHIC_3D_CRS:
                return '3D';
            case PJ_TYPE_PROJECTED_CRS:
                return 'P';
            case PJ_TYPE_COMPOUND_CRS:
                return 'C';
        }
        return '';
    }
    const showDeprecated = document.getElementById('show-deprecated').checked;
    crs_list.forEach((e) => {
        const text = `${e.auth}:${e.code} - ${e.name}`;
        if (!showDeprecated && e.deprecated) {
            // do not include deprecated
        } else if (e.type === PJ_TYPE_VERTICAL_CRS) {
            verticalData.push(text);
        } else if (only_projected_horizontal && e.type === PJ_TYPE_PROJECTED_CRS) {
            horizontalData.push(text);
        } else if (!only_projected_horizontal) {
            horizontalData.push(`${text}  {${typeToStr(e.type)}}`);
        }
    });
    return [horizontalData, verticalData];
}

let g_crs_list;
function get_crs_list() {
    const crs_list = proj.crs_list().filter((e, i, list) => {
        // there are some consecutive repeated elements, like EPSG:25832
        return i === 0 || e.auth !== list[i - 1].auth || e.code !== list[i - 1].code;
    });
    g_crs_list = crs_list;
    return crs_list;
}

async function setupAdvancedOptions(proj, proj_worker, callback) {
    const toggleBtn = document.getElementById('btn-advanced');
    const panel = document.getElementById('advanced-options-panel');

    // 1. Handle Panel Toggle
    if (toggleBtn && panel) {
        toggleBtn.addEventListener('click', () => {
            panel.classList.toggle('hidden');
            toggleBtn.classList.toggle('open');
        });
    }

    // 2. Handle File Selection & UI Updates
    ['db-file', 'aux-files'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;

        const display = document.getElementById(`${id}-name`);
        const clearBtn = document.querySelector(`[data-clear-file="${id}"]`);

        async function set(arg) {
            proj.set_database(arg);
            await proj_worker.set_database(arg);
        }

        // When the user selects files
        input.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);

            if (files.length > 0) {
                display.textContent = files.map((e) => e.name).join(', ');

                //const dbs = Array.from(files).map(async (file) => { name: file.name, array_buffer: await file.arrayBuffer() });
                const dbs = [];
                for (const file of files) {
                    dbs.push({ name: file.name, array_buffer: await file.arrayBuffer() });
                }
                if (id === 'db-file') {
                    await set({ db: dbs[0] });
                } else {
                    await set({ aux_dbs: dbs });
                }
                // Show active state and clear button
                display.classList.add('has-file');
                clearBtn.classList.remove('hidden');
                //} else {
                //    resetAdvancedFileInput(id, display, clearBtn);
            }
            callback();
        });

        // When the user clicks the 'x' button
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (id === 'db-file') {
                    await set({ db: null });
                } else {
                    await set({ aux_dbs: null });
                }
                resetAdvancedFileInput(id, display, clearBtn);
                callback();
            });
        }
    });
}

function resetAdvancedFileInput(id, displayEl, clearBtnEl) {
    const input = document.getElementById(id);
    if (input) input.value = ''; // Clears the actual file data from the input

    if (displayEl) {
        displayEl.textContent = id === 'aux-files' ? 'No files selected' : 'No file selected';
        displayEl.classList.remove('has-file');
    }

    if (clearBtnEl) {
        clearBtnEl.classList.add('hidden');
    }
}

function updateURLParams() {
    const oldParams = new URLSearchParams(window.location.search);

    const params = new URLSearchParams();
    const set = (key, value) => {
        if (key && value !== undefined) {
            params.set(key, value);
        }
    };

    set('nsrs_aux_db', oldParams.get('nsrs_aux_db') ?? '');

    set('st', document.querySelector('input[name="source_type"]:checked')?.value);
    set('tt', document.querySelector('input[name="target_type"]:checked')?.value);
    set('co', document.querySelector('input[name="coord_order"]:checked')?.value);

    set('sh', getCrsId(document.getElementById('source-horizontal-input')?.value));
    set('sv', getCrsId(document.getElementById('source-vertical-input')?.value));
    set('sf', document.getElementById('source-freetext')?.value);
    set('se', document.getElementById('source-epoch')?.value);

    set('th', getCrsId(document.getElementById('target-horizontal-input')?.value));
    set('tv', getCrsId(document.getElementById('target-vertical-input')?.value));
    set('tf', document.getElementById('target-freetext')?.value);
    set('te', document.getElementById('target-epoch')?.value);

    set('p3d', document.getElementById('promote-3d')?.checked ? '1' : '');
    set('net', document.getElementById('use-network')?.checked ? '1' : '');
    set('depr', document.getElementById('show-deprecated')?.checked ? '1' : '');
    set('coords', document.getElementById('source-coordinates')?.value);

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

function setVerticalEnabled(prefix, isEnabled) {
    // Traverse up to find the main .field wrapper for the vertical component
    const container = document.getElementById(`${prefix}-vertical-container`).closest('.field');
    const input = document.getElementById(`${prefix}-vertical-input`);

    if (isEnabled) {
        container.classList.remove('disabled');
        input.disabled = false;
    } else {
        container.classList.add('disabled');
        input.disabled = true;

        // Clear out existing data when disabled so it isn't accidentally processed
        input.value = '';
        updateCRSLink(prefix, 'vertical', '');
    }

    // re-validate the form and update the URL when the state changes?
    // validateForm();
}

function manageVertical(prefix, crs_list) {
    const PJ_TYPE_GEOGRAPHIC_2D_CRS = 12;
    const PJ_TYPE_PROJECTED_CRS = 15;

    const horizAuthCode = getCrsAuthCode(document.getElementById(`${prefix}-horizontal-input`).value);
    const inList = findInCrsList(horizAuthCode, crs_list);
    if (inList && (inList.type === PJ_TYPE_GEOGRAPHIC_2D_CRS || inList.type === PJ_TYPE_PROJECTED_CRS)) {
        setVerticalEnabled(prefix, true);
    } else {
        setVerticalEnabled(prefix, false);
    }
}

function getFullDescriptor(crs_list, id, return_id) {
    const [auth, code] = (id ?? '').split(':');
    const found = crs_list.find((e) => e.auth === auth && e.code === code);
    if (found) {
        return `${found.auth}:${found.code} - ${found.name}`;
    }
    return return_id ? id : undefined;
}

async function loadFromURLParams(crs_list, searchParams = undefined) {
    const params = searchParams ?? new URLSearchParams(window.location.search);

    if (params.get('nsrs_aux_db') === '1') {
        await loadAuxDbUrl(crs_list);
    }

    if (params.has('st'))
        document.querySelector(`input[name="source_type"][value="${params.get('st')}"]`).checked = true;
    if (params.has('tt'))
        document.querySelector(`input[name="target_type"][value="${params.get('tt')}"]`).checked = true;
    if (params.has('co'))
        document.querySelector(`input[name="coord_order"][value="${params.get('co')}"]`).checked = true;

    if (params.has('sh'))
        document.getElementById('source-horizontal-input').value = getFullDescriptor(crs_list, params.get('sh'), true);
    if (params.has('sv'))
        document.getElementById('source-vertical-input').value = getFullDescriptor(crs_list, params.get('sv'), true);
    if (params.has('sf')) document.getElementById('source-freetext').value = params.get('sf') ?? '';

    if (params.has('th'))
        document.getElementById('target-horizontal-input').value = getFullDescriptor(crs_list, params.get('th'), true);
    if (params.has('tv'))
        document.getElementById('target-vertical-input').value = getFullDescriptor(crs_list, params.get('tv'), true);
    if (params.has('tf')) document.getElementById('target-freetext').value = params.get('tf') ?? '';

    if (params.has('se')) {
        document.getElementById('source-epoch').disabled = false;
        document.getElementById('source-epoch').value = params.get('se');
    }

    if (params.has('te')) {
        document.getElementById('target-epoch').disabled = false;
        document.getElementById('target-epoch').value = params.get('te');
    }

    document.getElementById('source-coordinates').value = params.get('coords') ?? '';
    if (params.has('p3d'))
        if (params.has('p3d')) document.getElementById('promote-3d').checked = params.get('p3d') === '1';
    if (params.has('net')) document.getElementById('use-network').checked = params.get('net') === '1';
    if (params.has('depr')) document.getElementById('show-deprecated').checked = params.get('depr') === '1';

    for (const id of [
        'source-horizontal-input',
        'source-vertical-input',
        'target-horizontal-input',
        'target-vertical-input',
    ]) {
        if (document.getElementById(id)) document.getElementById(id).title = document.getElementById(id).value;
    }
    return params.get('run') === '1';
}

function updateAfterLoadUrl(crs_list) {
    ['source', 'target'].forEach((prefix) => {
        if (!document.getElementById(`${prefix}-horizontal-input`)) {
            return;
        }
        manageVertical(prefix, crs_list);

        toggleInputs(prefix, true);

        updateCRSLink(prefix, 'horizontal', getCrsId(document.getElementById(`${prefix}-horizontal-input`).value));
        updateCRSLink(prefix, 'vertical', getCrsId(document.getElementById(`${prefix}-vertical-input`).value));
    });
}

async function loadAuxDbUrl(crs_list, only_projected_horizontal) {
    const aux_db_url = 'https://jjimenezshaw.github.io/NSRS-2022-PROJ/nsrs_proj.db';
    console.time(`loading ${aux_db_url}`);
    try {
        const response = await fetch(aux_db_url);
        const file = await response.blob();
        const filename = aux_db_url.split('/').pop();
        const dbs = [{ name: filename, array_buffer: await file.arrayBuffer() }];
        proj.set_database({ aux_dbs: dbs });
        await g_proj_worker.set_database({ aux_dbs: dbs });

        const id = 'aux-files';
        const display = document.getElementById(`${id}-name`);
        const clearBtn = document.querySelector(`[data-clear-file="${id}"]`);
        display.textContent = filename;
        display.classList.add('has-file');
        clearBtn.classList.remove('hidden');
        crs_list.splice(0, Infinity, ...get_crs_list());
        updateComboboxes(crs_list, only_projected_horizontal);
        return true;
    } catch (e) {
        console.error(`error loading auxdb from ${aux_db_url}`, e);
    } finally {
        console.timeEnd(`loading ${aux_db_url}`);
    }
    return false;
}
