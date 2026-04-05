let currentCopyText = '';

document.addEventListener('DOMContentLoaded', () => {
    if (typeof setupAdvancedOptions === 'function') {
        setupAdvancedOptions();
    }

    // NOTE: This will move to common.js later
    setupLocalCustomDropdowns(['source-horizontal', 'source-vertical']);
    setupLocalInfoButtons(['source-horizontal', 'source-vertical']);

    setupEventListeners();
    loadFromURLParams();
});

function setupEventListeners() {
    // Input types (Search vs Freetext)
    document.querySelectorAll('input[name="source_type"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
            const isSearch = e.target.value === 'search';
            document.getElementById('source-search-group').classList.toggle('hidden', !isSearch);
            document.getElementById('source-freetext-group').classList.toggle('hidden', isSearch);
            updateURLParams();
        });
    });

    // Diagram Toggle
    document.getElementById('toggle-diagrams').addEventListener('change', (e) => {
        const resultsSection = document.getElementById('results-section');
        resultsSection.classList.toggle('hide-diagrams', !e.target.checked);
    });

    // File loading for coordinates
    document.getElementById('coords-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const targetEl = document.getElementById('coords-input');
            targetEl.value = event.target.result;
            targetEl.dispatchEvent(new Event('input')); // Wake up clear button
            updateURLParams();
        };
        reader.readAsText(file);
    });

    // Compute and Copy
    document.getElementById('btn-compute').addEventListener('click', () => {
        updateURLParams();
        processAllCoordinates();
    });

    document.getElementById('btn-copy').addEventListener('click', (e) => {
        navigator.clipboard.writeText(currentCopyText).then(() => {
            const btn = e.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => (btn.textContent = originalText), 2000);
        });
    });

    // URL updating on inputs
    const trackInputs = [
        'source-horizontal-input',
        'source-vertical-input',
        'source-freetext',
        'coords-input',
        'use-network',
    ];
    trackInputs.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', updateURLParams);
        }
    });

    document.querySelectorAll('input[name="coord_order"]').forEach((radio) => {
        radio.addEventListener('change', updateURLParams);
    });
}

function processAllCoordinates() {
    const rawInput = document.getElementById('coords-input').value;
    const lines = rawInput
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const orderRadio = document.querySelector('input[name="coord_order"]:checked');
    const isEastingNorthing = orderRadio && orderRadio.value === 'en';

    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    currentCopyText = '';

    if (lines.length === 0) return;

    lines.forEach((line, index) => {
        const parts = line.split(/\s+/);
        if (parts.length < 2) return;

        let x, y;
        if (isEastingNorthing) {
            x = parseFloat(parts[0]);
            y = parseFloat(parts[1]);
        } else {
            y = parseFloat(parts[0]);
            x = parseFloat(parts[1]);
        }

        // MOCK DATA for visualization
        const params = {
            meridian_scale: 1.0,
            parallel_scale: 1.2 + index * 0.1,
            convergence: 15 + index * 5,
            semi_major: 1.3 + index * 0.1,
            semi_minor: 0.8,
            ellipse_angle: 30 + index * 10,
            area_scale: 1.47,
            max_angular_dist: 25.4,
        };

        buildCopyText(line, params);

        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = `
            <div class="card-title">Point: ${line}</div>
            <div class="card-body">
                <div class="card-data">
                    ${generateTableHTML(params)}
                </div>
                <div class="card-visual">
                    <canvas width="250" height="250"></canvas>
                </div>
            </div>
        `;

        container.appendChild(card);
        const canvas = card.querySelector('canvas');
        drawIndicatrix(canvas, params);
    });

    document.getElementById('results-section').classList.remove('hidden');
}

// Generates a clean HTML table instead of divs
function generateTableHTML(params) {
    const labels = {
        meridian_scale: 'Meridian Scale (h)',
        parallel_scale: 'Parallel Scale (k)',
        convergence: 'Convergence (γ)',
        semi_major: 'Semi-major Axis (a)',
        semi_minor: 'Semi-minor Axis (b)',
        ellipse_angle: 'Ellipse Angle (θ)',
        area_scale: 'Area Scale (s)',
        max_angular_dist: 'Max Ang. Distortion (ω)',
    };

    let rows = '';
    for (const [key, value] of Object.entries(params)) {
        rows += `
            <tr>
                <th>${labels[key] || key}</th>
                <td>${value.toFixed(5)}</td>
            </tr>`;
    }

    return `<table class="params-table"><tbody>${rows}</tbody></table>`;
}

function buildCopyText(pointString, params) {
    currentCopyText += `--- Point: ${pointString} ---\n`;
    for (const [key, value] of Object.entries(params)) {
        currentCopyText += `${key}: ${value.toFixed(5)}\n`;
    }
    currentCopyText += `\n`;
}

function drawIndicatrix(canvas, params) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const maxDimension = Math.max(params.semi_major, params.semi_minor, 1.0);
    const scale = width / 2.5 / maxDimension;

    ctx.save();
    ctx.translate(width / 2, height / 2);

    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.moveTo(-width / 2, 0);
    ctx.lineTo(width / 2, 0);
    ctx.moveTo(0, -height / 2);
    ctx.lineTo(0, height / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.arc(0, 0, 1.0 * scale, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.save();
    ctx.rotate((params.convergence * Math.PI) / 180);
    ctx.beginPath();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    const hLen = params.meridian_scale * scale * 1.2;
    const kLen = params.parallel_scale * scale * 1.2;
    ctx.moveTo(0, -hLen);
    ctx.lineTo(0, hLen);
    ctx.moveTo(-kLen, 0);
    ctx.lineTo(kLen, 0);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.rotate((params.ellipse_angle * Math.PI) / 180);
    ctx.beginPath();
    ctx.strokeStyle = '#f97316';
    ctx.fillStyle = 'rgba(249, 115, 22, 0.2)';
    ctx.lineWidth = 2;
    ctx.ellipse(0, 0, params.semi_major * scale, params.semi_minor * scale, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
}

// --- URL Parameter Management ---
function updateURLParams() {
    const params = new URLSearchParams(window.location.search);

    const setOrDelete = (key, val) => (val ? params.set(key, val) : params.delete(key));

    const sType = document.querySelector('input[name="source_type"]:checked').value;
    params.set('stype', sType);

    if (sType === 'search') {
        setOrDelete('sh', document.getElementById('source-horizontal-input').value);
        setOrDelete('sv', document.getElementById('source-vertical-input').value);
        params.delete('sf');
    } else {
        setOrDelete('sf', document.getElementById('source-freetext').value);
        params.delete('sh');
        params.delete('sv');
    }

    const order = document.querySelector('input[name="coord_order"]:checked').value;
    params.set('order', order);

    setOrDelete('coords', document.getElementById('coords-input').value);

    if (document.getElementById('use-network').checked) {
        params.set('net', '1');
    } else {
        params.delete('net');
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

function loadFromURLParams() {
    const params = new URLSearchParams(window.location.search);

    const setIfPresent = (id, paramKey) => {
        if (params.has(paramKey)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = params.get(paramKey);
                el.dispatchEvent(new Event('input'));
            }
        }
    };

    if (params.has('stype')) {
        const radio = document.querySelector(`input[name="source_type"][value="${params.get('stype')}"]`);
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }
    }

    setIfPresent('source-horizontal-input', 'sh');
    setIfPresent('source-vertical-input', 'sv');
    setIfPresent('source-freetext', 'sf');
    setIfPresent('coords-input', 'coords');

    if (params.has('order')) {
        const radio = document.querySelector(`input[name="coord_order"][value="${params.get('order')}"]`);
        if (radio) radio.checked = true;
    }

    if (params.get('net') === '1') {
        document.getElementById('use-network').checked = true;
    }
}

// --- LOCAL COPIES TO MOVE TO COMMON.JS LATER ---
function setupLocalCustomDropdowns(inputIds) {
    // Stub for your custom dropdown logic referencing these IDs
}

function setupLocalInfoButtons(inputIds) {
    // Stub for your info modal/alert logic referencing these IDs
}
