/*
 * SPDX-FileCopyrightText: © 2026 Javier Jimenez Shaw
 * SPDX-License-Identifier: MIT
 */

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
