/**
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

async function copyToClipboard(targetId, btnElement) {
    const textArea = document.getElementById(targetId);

    // Don't do anything if the text area is empty
    if (!textArea.innerText.trim()) return;

    try {
        await navigator.clipboard.writeText(textArea.innerText);

        // Visual feedback
        const originalText = btnElement.innerText;
        btnElement.innerText = 'Copied!';
        btnElement.classList.add('btn-copied');

        // Revert back after 2 seconds
        setTimeout(() => {
            btnElement.innerText = originalText;
            btnElement.classList.remove('btn-copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        alert('Could not copy to clipboard. Please check browser permissions.');
    }
}

function updateURLParams() {
    const params = new URLSearchParams();
    params.set('params', document.getElementById('params-text').value);
    params.set('net', document.getElementById('use-network').checked ? '1' : '0');

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

    document.getElementById('params-text').value = params.get('params') ?? '';
    if (params.has('net')) document.getElementById('use-network').checked = params.get('net') === '1';
    return params.get('run') === '1';
}

function clearField(targetId) {
    const el = document.getElementById(targetId);
    el.value = '';
    el.title = '';
}

function parseParams(commandLine) {
    // Regex Breakdown:
    // 1. "([^"\\]*(?:\\.[^"\\]*)*)" : Matches double quotes, allowing escaped chars \"
    // 2. '([^'\\]*(?:\\.[^'\\]*)*)' : Matches single quotes, allowing escaped chars \'
    // 3. (?:\\(?=\s)|[^\s\\])+      : Matches unquoted text, allowing escaped spaces \
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|((?:\\(?=\s)|[^\s\\])+)/g;
    const params = [];

    const matches = commandLine.matchAll(regex);

    for (const match of matches) {
        const value = match[1] ?? match[2] ?? match[3];

        // Clean up the escapes (e.g., changing \" to ")
        // This mimics how BASH strips the escape character after processing
        params.push(value.replace(/\\(.)/g, '$1'));
    }

    return params;
}

function run(proj) {
    updateURLParams();
    const commandLine = document.getElementById('params-text').value;
    const use_network = document.getElementById('use-network').checked;
    const params = parseParams(commandLine);
    if (params.length && ['projinfo', 'projinfo.exe'].includes(params[0].toLowerCase())) {
        params.shift(); // allow the first param to be 'projinfo'
    }
    const res = proj.projinfo({ params: params, use_network: use_network });
    const ok = '&#9989;';
    const wrong = '&#10060;';
    document.getElementById('rc').innerHTML = `${res.rc} ${res.rc === 0 ? ok : wrong}`;
    document.getElementById('output-text').innerText = res.msg;
}

function setupEventListeners(proj) {
    document.querySelectorAll('[data-clear]').forEach((btn) => {
        btn.addEventListener('click', function () {
            clearField(this.getAttribute('data-clear'));
        });
    });
    document.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', function () {
            copyToClipboard(this.getAttribute('data-copy'), this);
        });
    });

    document.getElementById('btn-transform').addEventListener('click', () => run(proj));
}

async function load() {
    const appContent = document.getElementById('app-content');
    const loader = document.getElementById('loading-indicator');
    loader.classList.remove('hidden');

    console.log('Downloading resources...', Date());

    try {
        const proj = new Proj();
        await proj.init();
        const info = proj.proj_info();
        console.log('proj_info', info);
        console.log('database_metadata', proj.database_metadata());
        document.getElementById('proj-version').innerText = info.version;
        document.getElementById('proj-version').title = info.compilation_date;

        if (loadFromURLParams()) {
            run(proj);
        }

        setupEventListeners(proj);

        console.log('Ready.', Date());
    } catch (e) {
        console.error(e);
        alert(`Problems loading the library. Unexpected behaviour.\n\n${e.message}`);
    } finally {
        loader.classList.add('hidden');
        appContent.classList.remove('loading-state');
    }
}

window.addEventListener('load', load);
