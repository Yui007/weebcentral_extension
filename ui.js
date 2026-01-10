export const UIManager = {
    tabs: document.querySelectorAll('.tab-btn'),
    panes: document.querySelectorAll('.tab-pane'),
    statusElement: document.getElementById('status'),
    progressBar: document.getElementById('progressBar'),
    buttons: [
        'downloadChapter',
        'downloadZip',
        'downloadSelected'
    ],

    init() {
        this.initTabs();
    },

    initTabs() {
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.tabs.forEach(t => t.classList.remove('active'));
                this.panes.forEach(p => p.classList.remove('active'));

                tab.classList.add('active');
                const targetId = `tab-${tab.dataset.tab}`;
                document.getElementById(targetId).classList.add('active');
            });
        });
    },

    updateStatus(message) {
        if (this.statusElement) this.statusElement.textContent = message;
    },

    updateProgress(current, total) {
        if (!this.progressBar) return;
        const percentage = total > 0 ? (current / total) * 100 : 0;
        this.progressBar.style.width = percentage + '%';
    },

    setButtonsDisabled(disabled) {
        this.buttons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = disabled;
                if (disabled) {
                    if (!btn.dataset.originalText) btn.dataset.originalText = btn.innerHTML;
                    btn.textContent = 'Processing...';
                } else {
                    if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
                }
            }
        });
    },

    displayChapters(chapters, title, listElementId = 'chaptersList') {
        const list = document.getElementById(listElementId);
        if (!list) return;

        list.innerHTML = '';

        const titleEl = document.createElement('div');
        titleEl.style.padding = '5px 10px';
        titleEl.style.fontSize = '12px';
        titleEl.style.color = 'var(--text-secondary)';
        titleEl.textContent = title;
        list.appendChild(titleEl);

        chapters.forEach((ch, idx) => {
            const item = document.createElement('div');
            item.className = 'chapter-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = ch.url;

            let name = ch.name;
            if (!name || name.includes('{')) name = `Chapter ${ch.number || idx + 1}`;

            checkbox.dataset.name = name;
            checkbox.checked = true;

            const label = document.createElement('label');
            label.textContent = name;

            item.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
            });

            item.appendChild(checkbox);
            item.appendChild(label);
            list.appendChild(item);
        });
    },

    toggleChaptersView(show) {
        const emptyState = document.getElementById('empty-state');
        const container = document.getElementById('chaptersContainer');

        if (show) {
            if (emptyState) emptyState.classList.add('hidden');
            if (container) container.style.display = 'flex';
        } else {
            if (emptyState) emptyState.classList.remove('hidden');
            if (container) container.style.display = 'none';
        }
    }
};
