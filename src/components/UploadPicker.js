import { AuthModal } from './AuthModal.js';
import { getUploadHistory, saveUpload, removeUpload, generateThumbnail } from '../lib/uploadHistory.js';

/**
 * Creates a self-contained upload picker: a trigger button + history panel.
 *
 * @param {object} options
 * @param {HTMLElement} options.anchorContainer - The container element the panel is positioned relative to
 * @param {function({ inlineData: { mimeType: string, data: string }, thumbnail: string }): void} options.onSelect - Called when an image is selected
 * @param {function(): void} [options.onClear] - Called when the active selection is removed from history
 * @returns {{ trigger: HTMLElement, panel: HTMLElement, reset: function }}
 */
export function createUploadPicker({ anchorContainer, onSelect, onClear }) {
    let panelOpen = false;
    let selectedEntry = null; // { inlineData, thumbnail }

    const fileToInlineData = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== 'string') return reject(new Error('Invalid file data'));
            const commaIndex = result.indexOf(',');
            if (commaIndex === -1) return reject(new Error('Invalid data URL'));
            const header = result.slice(0, commaIndex);
            const data = result.slice(commaIndex + 1);
            const match = header.match(/^data:(.*?);base64$/);
            const mimeType = match?.[1] || file.type || 'application/octet-stream';
            resolve({ mimeType, data });
        };
        reader.readAsDataURL(file);
    });

    // ── Hidden file input ────────────────────────────────────────────────────
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';

    // ── Trigger button ───────────────────────────────────────────────────────
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.title = 'Reference image';
    trigger.className = 'w-10 h-10 shrink-0 rounded-xl border transition-all flex items-center justify-center relative overflow-hidden mt-1.5 bg-white/5 border-white/10 hover:bg-white/10 hover:border-primary/40 group';

    // State: icon
    const iconState = document.createElement('div');
    iconState.className = 'flex items-center justify-center w-full h-full';
    iconState.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted group-hover:text-primary transition-colors"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

    // State: spinner
    const spinnerState = document.createElement('div');
    spinnerState.className = 'hidden items-center justify-center w-full h-full';
    spinnerState.innerHTML = `<span class="animate-spin text-primary text-sm">◌</span>`;

    // State: thumbnail with checkmark badge
    const thumbnailState = document.createElement('div');
    thumbnailState.className = 'hidden w-full h-full';
    const thumbImg = document.createElement('img');
    thumbImg.className = 'w-full h-full object-cover';
    const badge = document.createElement('div');
    badge.className = 'absolute bottom-0.5 right-0.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center';
    badge.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>`;
    thumbnailState.appendChild(thumbImg);
    thumbnailState.appendChild(badge);

    trigger.appendChild(fileInput);
    trigger.appendChild(iconState);
    trigger.appendChild(spinnerState);
    trigger.appendChild(thumbnailState);

    // ── Trigger state helpers ────────────────────────────────────────────────
    const showIcon = () => {
        iconState.classList.replace('hidden', 'flex');
        spinnerState.classList.add('hidden'); spinnerState.classList.remove('flex');
        thumbnailState.classList.add('hidden'); thumbnailState.classList.remove('flex');
        trigger.classList.remove('border-primary/60');
        trigger.classList.add('border-white/10');
    };

    const showSpinner = () => {
        iconState.classList.add('hidden'); iconState.classList.remove('flex');
        spinnerState.classList.replace('hidden', 'flex');
        thumbnailState.classList.add('hidden'); thumbnailState.classList.remove('flex');
    };

    const showThumbnail = (src) => {
        thumbImg.src = src;
        iconState.classList.add('hidden'); iconState.classList.remove('flex');
        spinnerState.classList.add('hidden'); spinnerState.classList.remove('flex');
        thumbnailState.classList.replace('hidden', 'flex');
        trigger.classList.remove('border-white/10');
        trigger.classList.add('border-primary/60');
    };

    // ── Panel ────────────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.className = 'absolute z-50 opacity-0 pointer-events-none scale-95 origin-bottom-left glass rounded-3xl p-3 shadow-4xl border border-white/10 w-72 transition-all';

    const openPanel = () => {
        renderPanel();
        panel.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
        panel.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
        // Position relative to anchorContainer (matches existing dropdown math)
        const btnRect = trigger.getBoundingClientRect();
        const containerRect = anchorContainer.getBoundingClientRect();
        panel.style.left = `${btnRect.left - containerRect.left}px`;
        panel.style.bottom = `${containerRect.bottom - btnRect.top + 8}px`;
        panelOpen = true;
    };

    const closePanel = () => {
        panel.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
        panel.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
        panelOpen = false;
    };

    const renderPanel = () => {
        panel.innerHTML = '';
        const history = getUploadHistory();

        // Header
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between px-1 pb-3 mb-2 border-b border-white/5';
        header.innerHTML = `<span class="text-[10px] font-bold text-secondary uppercase tracking-widest">Reference Images</span>`;

        const uploadNewBtn = document.createElement('button');
        uploadNewBtn.type = 'button';
        uploadNewBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-xs font-bold transition-all border border-primary/20';
        uploadNewBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload new`;
        uploadNewBtn.onclick = (e) => { e.stopPropagation(); closePanel(); fileInput.click(); };
        header.appendChild(uploadNewBtn);
        panel.appendChild(header);

        if (history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'py-6 flex flex-col items-center gap-2 opacity-40';
            empty.innerHTML = `
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-secondary"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span class="text-xs text-secondary">No uploads yet</span>
            `;
            panel.appendChild(empty);
            return;
        }

        // Grid of saved uploads
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-3 gap-2 max-h-56 overflow-y-auto custom-scrollbar pr-0.5';

        history.forEach(entry => {
            const hasInline = !!entry.inlineData?.data;
            const isSelected = hasInline && selectedEntry?.inlineData?.data === entry.inlineData?.data;

            const cell = document.createElement('div');
            cell.className = `relative rounded-xl overflow-hidden border-2 cursor-pointer group/cell aspect-square transition-all ${isSelected ? 'border-primary shadow-glow' : 'border-white/10 hover:border-white/30'}`;
            cell.title = entry.name;

            const img = document.createElement('img');
            img.src = entry.thumbnail;
            img.className = 'w-full h-full object-cover';

            // Hover overlay with delete button
            const overlay = document.createElement('div');
            overlay.className = 'absolute inset-0 bg-black/60 opacity-0 group-hover/cell:opacity-100 transition-opacity flex items-end justify-end p-1';

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'w-5 h-5 bg-red-500/80 hover:bg-red-500 rounded-md flex items-center justify-center transition-colors';
            delBtn.title = 'Remove from history';
            delBtn.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            delBtn.onclick = (e) => {
                e.stopPropagation();
                removeUpload(entry.id);
                if (selectedEntry?.inlineData?.data === entry.inlineData?.data) {
                    selectedEntry = null;
                    showIcon();
                    onClear?.();
                }
                renderPanel();
            };
            overlay.appendChild(delBtn);

            // Selected checkmark badge
            if (isSelected) {
                const check = document.createElement('div');
                check.className = 'absolute top-1 left-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center';
                check.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>`;
                cell.appendChild(check);
            }

            cell.appendChild(img);
            cell.appendChild(overlay);

            cell.onclick = (e) => {
                e.stopPropagation();
                if (!hasInline) {
                    alert('This upload is from a previous version and cannot be reused. Please upload the image again.');
                    return;
                }
                selectedEntry = { inlineData: entry.inlineData, thumbnail: entry.thumbnail };
                showThumbnail(entry.thumbnail);
                onSelect({ inlineData: entry.inlineData, thumbnail: entry.thumbnail });
                closePanel();
            };

            grid.appendChild(cell);
        });

        panel.appendChild(grid);
    };

    // ── Trigger click ────────────────────────────────────────────────────────
    trigger.onclick = (e) => {
        e.stopPropagation();
        if (panelOpen) closePanel();
        else openPanel();
    };

    // Close panel on outside click
    window.addEventListener('click', closePanel);

    // ── File upload handler ──────────────────────────────────────────────────
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const apiKey = localStorage.getItem('google_ai_key');
        if (!apiKey) {
            AuthModal(() => fileInput.click());
            return;
        }

        showSpinner();

        try {
            const [inlineData, thumbnail] = await Promise.all([
                fileToInlineData(file),
                generateThumbnail(file)
            ]);

            const entry = {
                id: Date.now().toString(),
                name: file.name,
                inlineData,
                thumbnail,
                timestamp: new Date().toISOString()
            };

            saveUpload(entry);
            selectedEntry = { inlineData, thumbnail };
            showThumbnail(thumbnail);
            onSelect({ inlineData, thumbnail });
        } catch (err) {
            console.error('[UploadPicker] Upload failed:', err);
            showIcon();
            alert(`Image upload failed: ${err.message}`);
        }

        fileInput.value = '';
    };

    // ── Public API ───────────────────────────────────────────────────────────
    const reset = () => {
        selectedEntry = null;
        showIcon();
        closePanel();
    };

    return { trigger, panel, reset };
}
