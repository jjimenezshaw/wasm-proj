'use strict'

// Safari cannot change the display in options in select. So do a heavier work.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

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
    reader.onload = function (e) {
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

    params.set('st', document.querySelector('input[name="source_type"]:checked').value);
    params.set('tt', document.querySelector('input[name="target_type"]:checked').value);

    params.set('sh', getCrsId(document.getElementById('source-horizontal-input').value));
    params.set('sv', getCrsId(document.getElementById('source-vertical-input').value));
    params.set('sf', document.getElementById('source-freetext').value);
    params.set('se', document.getElementById('source-epoch').value);

    params.set('th', getCrsId(document.getElementById('target-horizontal-input').value));
    params.set('tv', getCrsId(document.getElementById('target-vertical-input').value));
    params.set('tf', document.getElementById('target-freetext').value);
    params.set('te', document.getElementById('target-epoch').value);

    params.set('p3d', document.getElementById('promote-3d').checked ? '1' : '');
    params.set('net', document.getElementById('use-network').checked ? '1' : '');
    params.set('coords', document.getElementById('source-coordinates').value);

    const keysToDelete = [];
    params.forEach((value, key) => {
        if (value === '') keysToDelete.push(key);
    });
    keysToDelete.forEach(key => params.delete(key));

    const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
}

function loadFromURLParams(crs_list) {
    const params = new URLSearchParams(window.location.search);

    if (params.has('st')) document.querySelector(`input[name="source_type"][value="${params.get('st')}"]`).checked = true;
    if (params.has('tt')) document.querySelector(`input[name="target_type"][value="${params.get('tt')}"]`).checked = true;

    document.getElementById('source-horizontal-input').value = getFullDescriptor(crs_list, params.get('sh')) ?? '';
    document.getElementById('source-vertical-input').value = getFullDescriptor(crs_list, params.get('sv')) ?? '';
    document.getElementById('source-freetext').value = params.get('sf') ?? '';

    document.getElementById('target-horizontal-input').value = getFullDescriptor(crs_list, params.get('th')) ?? '';
    document.getElementById('target-vertical-input').value = getFullDescriptor(crs_list, params.get('tv')) ?? '';
    document.getElementById('target-freetext').value = params.get('tf') ?? '';

    if (params.has('se')) {
        document.getElementById('source-epoch').disabled = false;
        document.getElementById('source-epoch').value = params.get('se');
    }

    if (params.has('te')) {
        document.getElementById('target-epoch').disabled = false;
        document.getElementById('target-epoch').value = params.get('te');
    }
    document.getElementById('source-coordinates').value = params.get('coords') ?? '';
    if (params.has('p3d')) document.getElementById('promote-3d').checked = params.get('p3d') === '1';
    if (params.has('net')) document.getElementById('use-network').checked = params.get('net') === '1';

    for (let id of ['source-horizontal-input', 'source-vertical-input', 'target-horizontal-input', 'target-vertical-input']) {
        document.getElementById(id).title = document.getElementById(id).value;
    }
    return params.get('run') === '1';
}

function validateForm(doNotUpdateUrl = false) {
    const btn = document.getElementById('btn-transform');
    const coords = document.getElementById('source-coordinates').value.trim();

    function checkColumnValidity(prefix) {
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

    if (!doNotUpdateUrl)
        updateURLParams();
}

function updateCRSLink(prefix, type, value) {
    const linkElement = document.getElementById(`${prefix}-${type}-link`);
    if (!linkElement) return;

    if (value) {
        let pair = getCrsAuthCode(value);

        if (pair[0]) {
            const auth = pair[0];
            const code = pair[1];
            linkElement.href = `https://spatialreference.org/ref/${auth.toLowerCase()}/${code}/`;
            linkElement.classList.remove('disabled');
            linkElement.title = `View ${auth}:${code} details`;
        } else {
            linkElement.href = "#";
            linkElement.classList.add('disabled');
            linkElement.title = "No external link available";
        }
    } else {
        linkElement.href = "#";
        linkElement.classList.add('disabled');
        linkElement.title = "Select a CRS to view details";
    }
}

function setEpochEnabled(prefix, isEnabled) {
    const container = document.getElementById(`${prefix}-epoch-container`);
    const input = document.getElementById(`${prefix}-epoch`);
    const helper = container.querySelector('.helper-text');

    if (isEnabled) {
        container.classList.remove('disabled');
        input.disabled = false;
        helper.classList.add('hidden')
    } else {
        container.classList.add('disabled');
        input.disabled = true;
        helper.classList.remove('hidden')
        input.value = '';
    }

    // validateForm();
}

function toggleInputs(columnPrefix, doNotUpdateUrl = false) {
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

function getCrsFromInput(prefix) {
    const selectedType = document.querySelector(`input[name="${prefix}_type"]:checked`).value;
    let crs = '';
    if (selectedType === 'combo') {
        const horiz = getCrsId(document.getElementById(`${prefix}-horizontal-input`).value);
        const vert = getCrsId(document.getElementById(`${prefix}-vertical-input`).value);
        if (horiz) {
            crs = horiz;
            if (vert) crs += '+' + vert;
        }
    } else {
        crs = document.getElementById(`${prefix}-freetext`).value;
    }
    return crs;
}

function updateMetadata(prefix) {
    const metadataBox = document.getElementById(`${prefix}-metadata`);
    let crs = getCrsFromInput(prefix);

    let metadataText = "";

    const prev_log_level = proj.log_level(0); // disable PROJ log messages
    try {
        const metadata = crs ? proj.obj_metadata({ crs: crs }) : {};
        if (metadata.is_crs) {
            setEpochEnabled(prefix, metadata.datum_is_dynamic);

            const a = proj.crs_axes({ crs: crs });
            for (let i = 0; i < a.name.length; i++) {
                if (i > 0) metadataText += "\n";
                metadataText += `${a.name[i]} (${a.abbr[i]})  |  ${a.direction[i]}  -  [${a.unit[i]}]`
            }
            if (!a.name?.length) {
                metadataText = `Cannot get data from '${crs}'`;
            } else if (prefix == 'target') {
                const axUnit = a.unit[0].toLowerCase();
                const dp = document.getElementById(`decimal-places`);
                if (axUnit.includes('degree') || axUnit.includes('rad')) {
                    dp.value = 9;
                } else {
                    dp.value = 4;
                }
            }
        } else {
            setEpochEnabled(prefix, false);
        }
    } finally {
        proj.log_level(prev_log_level);
    }

    metadataBox.value = metadataText;
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

function findInCrsList(authCode, crs_list) {
    if (authCode.length < 2) return null;
    const ac = authCode.map(e => e.toLowerCase());
    const inList = crs_list.find(e => e.auth.toLowerCase() == ac[0] && e.code.toLowerCase() == ac[1]);
    return inList;
}

function populateSelect(selectElement, dataArray) {
    const fragment = document.createDocumentFragment();
    dataArray.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        option.title = item;
        fragment.appendChild(option);
    });
    selectElement.appendChild(fragment);
}

function clearField(targetId) {
    const el = document.getElementById(targetId);
    el.value = '';
    el.title = '';

    // Dispatch an input event so your validation, metadata, and URL updating functions run automatically
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // The ideas was to keep the user's cursor in the box
    // but Chrome is taking a long time... let's do it for now.
    el.focus();
}

function manageVertical(prefix, crs_list) {
    const PJ_TYPE_GEOGRAPHIC_2D_CRS = 12;
    const PJ_TYPE_PROJECTED_CRS = 15;

    const horizAuthCode = getCrsAuthCode(document.getElementById(`${prefix}-horizontal-input`).value);
    const inList = findInCrsList(horizAuthCode, crs_list);
    if (inList && (inList.type == PJ_TYPE_GEOGRAPHIC_2D_CRS || inList.type == PJ_TYPE_PROJECTED_CRS)) {
        setVerticalEnabled(prefix, true);
    } else {
        setVerticalEnabled(prefix, false);
    }
}

// prefix: source, target
// type: horizontal, vertical
function setupCustomCombobox(prefix, type, dataArray, crs_list) {
    const container = document.getElementById(`${prefix}-${type}-container`);
    const input = document.getElementById(`${prefix}-${type}-input`);
    const select = document.getElementById(`${prefix}-${type}-select`);

    populateSelect(select, dataArray);
    select.selectedIndex = -1;

    input.addEventListener('focus', () => container.classList.add('open'));
    input.addEventListener('click', () => container.classList.add('open'));

    container.addEventListener('focusout', function (e) {
        const authCode = getCrsAuthCode(e.target.value);
        if (authCode[0] && !findInCrsList(authCode, crs_list)) {
            e.target.classList.add('invalid');
            e.target.title = 'Element not in the catalog.'
        } else {
            e.target.classList.remove('invalid');
            e.target.title = ''
        }
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('open');
        }
    });

    function handleSelection(val) {
        input.value = val;
        input.title = val;
        container.classList.remove('open');
        // The ideas was to keep the user's cursor in the box
        // but Chrome is taking a long time... and it is not worth it. Just press <tab>
        // input.focus();

        updateMetadata(prefix);
        updateCRSLink(prefix, type, val);
        if (type == 'horizontal') manageVertical(prefix, crs_list);
        validateForm();
    }

    select.addEventListener('change', function () {
        if (this.value) handleSelection(this.value);
    });

    select.addEventListener('click', function (e) {
        if (e.target.tagName === 'OPTION' || e.target.tagName === 'SELECT') {
            if (select.value) handleSelection(select.value);
        }
    });

    document.addEventListener('click', function (e) {
        if (!container.contains(e.target)) container.classList.remove('open');
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!container.classList.contains('open')) container.classList.add('open');

            const direction = e.key === 'ArrowDown' ? 1 : -1;
            const options = select.options;
            let currentIndex = select.selectedIndex;
            let nextIndex = -1;

            if (direction === 1) {
                let start = currentIndex >= 0 ? currentIndex + 1 : 0;
                for (let i = start; i < options.length; i++) {
                    if (!options[i].classList.contains('hidden')) { nextIndex = i; break; }
                }
            } else {
                let start = currentIndex >= 0 ? currentIndex - 1 : options.length - 1;
                for (let i = start; i >= 0; i--) {
                    if (!options[i].classList.contains('hidden')) { nextIndex = i; break; }
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

    input.addEventListener('input', function (e) {
        container.classList.add('open');
        const inputText = e.target.value;
        select.selectedIndex = -1;

        updateCRSLink(prefix, type, inputText);
        updateMetadata(prefix);

        // many people writes WGS84
        const filterArray = inputText.toLowerCase().replace('wgs84', 'wgs 84').split(' ');

        function filter(text) {
            const lower = text.toLowerCase();
            return filterArray.every(e => lower.includes(e));
        }

        if (isSafari) {
            select.innerHTML = '';
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < dataArray.length; i++) {
                if (filter(dataArray[i])) {
                    const option = document.createElement('option');
                    option.value = dataArray[i];
                    option.title = dataArray[i];
                    option.textContent = dataArray[i];
                    fragment.appendChild(option);
                }
            }
            select.appendChild(fragment);
        } else {
            const options = select.options;
            for (let i = 0; i < options.length; i++) {
                options[i].classList.toggle('hidden', !filter(options[i].textContent));
            }
        }
    });
}

function parseInputCoordinates(sourceCoords) {
    const coordLines = sourceCoords.split('\n').filter(line => line.trim().length > 0);
    let points = []
    coordLines.forEach(line => {
        let splitted = []
        for (let separator of [';', ',', '\t', ' ']) {
            splitted = line.split(separator);
            if (splitted.length >= 2) {
                break;
            }
        }
        // replace ',' as decimal separator with ';' column separator
        splitted = splitted.map(e => e.replace(',', '.'));
        splitted = splitted.filter(n => n) // remove empty elements
        const floats = splitted.map(e => Number.parseFloat(e));
        points.push(floats);
    })
    return points;
}

function showPointsInMap(proj) {
    const coords = document.getElementById('source-coordinates').value;
    if (!coords.trim()) {
        console.log("No points to show in the map.")
        return;
    }

    const points = parseInputCoordinates(coords).map(e => e.slice(0, 2));

    let transformer;
    try {
        const s = getCrsFromInput('source');
        if (s.length === 0) throw new Error('Select a valid source CRS')
        const t = 'EPSG:4326';
        transformer = proj.create_transformer_from_crs({
            source_crs: s, target_crs: t, promote_to_3D: false,
        });
        const transformed = transformer.transform({ points: points });
        const res = transformed.map(point => point.map(e => e.toFixed(6)).join(',')).join(';');
        const mapUrl = `./pointsinmap.html?points=${res}`;
        window.open(mapUrl, '_blank');
    } catch (e) {
        console.error('Error showing in a map: ' + e);
        return;
    } finally {
        if (transformer) transformer.dispose();
    }
}

async function handleTransform(proj_worker) {
    const sourceCoords = document.getElementById('source-coordinates').value;

    if (!sourceCoords.trim()) return;

    const output = document.getElementById('target-coordinates');
    output.value = '... computing ...'

    const promote3D = document.getElementById('promote-3d').checked;
    const useNetwork = document.getElementById('use-network').checked;

    const points = parseInputCoordinates(sourceCoords);

    const summaryBox = document.getElementById('transformation-summary');
    summaryBox.innerText = '';
    let transformer;
    try {
        try {
            const s = getCrsFromInput('source');
            const t = getCrsFromInput('target')
            transformer = await proj_worker.create_transformer_from_crs({
                source_crs: s,
                target_crs: t,
                source_epoch: parseFloat(document.getElementById('source-epoch').value),
                target_epoch: parseFloat(document.getElementById('target-epoch').value),
                use_network: useNetwork,
                promote_to_3D: promote3D,
            });
        } catch (e) {
            output.value = 'Error:' + e;
            return;
        }
        try {
            const transformed = await transformer.transform({ points: points });
            const dp = document.getElementById(`decimal-places`).value;

            let res = transformed.map(point => point.map((e, index) => e.toFixed(index < 2 ? dp : 4)).join(' ')).join('\n');
            output.value = res;
        } catch (e) {
            output.value = 'Error:' + e;
            return;
        }
        try {
            const lastOp = await transformer.get_last_operation();
            const date = new Date().toLocaleString();
            summaryBox.innerText = lastOp.description + '\n\n' + lastOp.proj_5 + '\n\n' + date;
        } catch (e) {
            summaryBox.innerText = 'Error: ' + e;
        }
    } finally {
        if (transformer) await transformer.dispose();
    }
}

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

function getFullDescriptor(crs_list, id) {
    const [auth, code] = (id ?? '').split(':');
    const found = crs_list.find(e => e.auth == auth && e.code == code);
    if (found) {
        return `${found.auth}:${found.code} - ${found.name}`;
    }
    return '';
}

function setupEventListeners(proj_worker, proj) {
    // 1. Checkboxes & simple inputs
    ['promote-3d', 'use-network'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => validateForm());
    });

    ['source-horizontal-input', 'source-vertical-input', 'source-epoch',
        'target-horizontal-input', 'target-vertical-input', 'target-epoch',
        'source-coordinates'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => validateForm());
        });

    // 2. Radio buttons
    document.querySelectorAll('input[name="source_type"]').forEach(radio => {
        radio.addEventListener('change', () => toggleInputs('source'));
    });
    document.querySelectorAll('input[name="target_type"]').forEach(radio => {
        radio.addEventListener('change', () => toggleInputs('target'));
    });

    // 3. Freetext areas (Need metadata update + validation)
    ['source', 'target'].forEach(prefix => {
        document.getElementById(`${prefix}-freetext`).addEventListener('input', () => {
            updateMetadata(prefix);
            validateForm();
        });
    });

    // 4. File inputs
    document.getElementById('source-file').addEventListener('change', (e) => handleFileLoad(e, 'source-freetext'));
    document.getElementById('target-file').addEventListener('change', (e) => handleFileLoad(e, 'target-freetext'));
    document.getElementById('coords-file').addEventListener('change', (e) => handleFileLoad(e, 'source-coordinates'));

    // 5. Data-Attribute Buttons (Clear, Load, Copy)
    document.querySelectorAll('[data-clear]').forEach(btn => {
        btn.addEventListener('click', function () { clearField(this.getAttribute('data-clear')); });
    });
    document.querySelectorAll('[data-load]').forEach(btn => {
        btn.addEventListener('click', function () { document.getElementById(this.getAttribute('data-load')).click(); });
    });
    document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', function () { copyToClipboard(this.getAttribute('data-copy'), this); });
    });

    // 6. Main Action Buttons
    document.getElementById('points-in-map').addEventListener('click', () => showPointsInMap(proj));
    document.getElementById('btn-transform').addEventListener('click', () => handleTransform(proj_worker));
}

let proj;

async function load() {
    const appContent = document.getElementById('app-content');
    const loader = document.getElementById('loading-indicator');
    loader.classList.remove('hidden');

    console.log("Downloading resources...", Date());

    proj = new Proj();
    await proj.init();
    const info = proj.proj_info();
    console.log(info);
    document.getElementById('proj-version').innerText = info.version;
    document.getElementById('proj-version').title = info.compilation_date;
    const crs_list = proj.crs_list().filter((e, i, list) => {
        // there are some consecutive repeated elements, like EPSG:25832
        return i == 0 || e.auth != list[i - 1].auth || e.code != list[i - 1].code;
    });
    /////////////////////////
    const bridge = new WorkerBridge();
    const proj_worker = bridge.create_main_proxy();
    await proj_worker.init();

    const horizontalData = [];
    const verticalData = [" - none / ellipsodial height"];
    const PJ_TYPE_VERTICAL_CRS = 14;
    crs_list.forEach(e => {
        const text = `${e.auth}:${e.code} - ${e.name}`;
        if (e.type == PJ_TYPE_VERTICAL_CRS) {
            verticalData.push(text);
        } else {
            horizontalData.push(text);
        }
    });

    setupCustomCombobox('source', 'horizontal', horizontalData, crs_list);
    setupCustomCombobox('source', 'vertical', verticalData, crs_list);
    setupCustomCombobox('target', 'horizontal', horizontalData, crs_list);
    setupCustomCombobox('target', 'vertical', verticalData, crs_list);

    const run = loadFromURLParams(crs_list);

    manageVertical('source', crs_list);
    manageVertical('target', crs_list);

    toggleInputs('source', true);
    toggleInputs('target', true);

    updateCRSLink('source', 'horizontal', getCrsId(document.getElementById('source-horizontal-input').value));
    updateCRSLink('source', 'vertical', getCrsId(document.getElementById('source-vertical-input').value));
    updateCRSLink('target', 'horizontal', getCrsId(document.getElementById('target-horizontal-input').value));
    updateCRSLink('target', 'vertical', getCrsId(document.getElementById('target-vertical-input').value));

    setupEventListeners(proj_worker, proj);

    loader.classList.add('hidden');
    appContent.classList.remove('loading-state');
    console.log("Ready.", Date());

    if (run) handleTransform(proj_worker);
};

window.addEventListener('load', load);
