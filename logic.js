import { UIManager } from './ui.js';
import { SettingsManager } from './settings.js';

export const LogicManager = {
    init() {
        this.allChapters = []; // Store fetched chapters here
        this.mangaTitle = '';

        this.setupListeners();
        this.setupMessageListener();
        this.checkStatus();
        this.restoreState(); // Restore previous session logic

        // Auto-fetch if starting on chapters tab and no chapters loaded
        if (document.querySelector('.tab-btn[data-tab="chapters"]').classList.contains('active')) {
            // Only auto-fetch if we didn't restore any chapters
            setTimeout(() => {
                const list = document.getElementById('chaptersList');
                if (!list || list.children.length === 0) {
                    LogicManager.handleFetchChapters();
                }
            }, 100);
        }
    },

    async saveState() {
        const state = {
            chapters: this.allChapters,
            mangaTitle: this.mangaTitle,
            timestamp: Date.now()
        };
        await chrome.storage.local.set({ 'popupState': state });
    },

    async restoreState() {
        const data = await chrome.storage.local.get('popupState');
        if (data && data.popupState) {
            const { chapters, mangaTitle, timestamp } = data.popupState;
            // Valid for 1 hour? Or just keep it until manual refresh?
            // Let's keep it simple: if it exists, use it.
            if (chapters && chapters.length > 0) {
                this.allChapters = chapters;
                this.mangaTitle = mangaTitle;
                this.applyChapterFilter(); // Display them
                UIManager.toggleChaptersView(true);
            }
        }
    },

    applyChapterFilter() {
        if (!this.allChapters || this.allChapters.length === 0) return;

        const rangeRange = document.getElementById('chapterRange');
        const range = rangeRange ? rangeRange.value.trim() : '';

        // Parse range to find which chapters to SELECT
        const settings = {};
        const scraper = new MangaScraper(settings);
        const selectedChapters = scraper.parseChapterRange(range, this.allChapters);
        const selectedUrls = new Set(selectedChapters.map(c => c.url));

        // Iterate through all checkboxes in the list
        const checkboxes = document.querySelectorAll('#chaptersList input[type="checkbox"]');
        let selectedCount = 0;

        checkboxes.forEach(cb => {
            if (selectedUrls.has(cb.value)) {
                cb.checked = true;
                selectedCount++;
                // Highlight logic could be added here
                cb.parentElement.style.opacity = '1';
            } else {
                cb.checked = false;
                cb.parentElement.style.opacity = '0.5'; // Dim unselected
            }
        });

        UIManager.updateStatus(`Selected ${selectedCount} chapters.`);
    },

    setupListeners() {
        // Tab switch listener to trigger fetch
        document.querySelectorAll('.tab-btn[data-tab="chapters"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const list = document.getElementById('chaptersList');
                if (!list || list.children.length === 0) {
                    LogicManager.handleFetchChapters();
                }
            });
        });

        // Range Input Listener for Real-time filtering
        const rangeInput = document.getElementById('chapterRange');
        if (rangeInput) {
            rangeInput.addEventListener('input', () => this.applyChapterFilter());
        }

        // Download Selected
        const dlSelectedBtn = document.getElementById('downloadSelected');
        if (dlSelectedBtn) dlSelectedBtn.addEventListener('click', () => this.handleDownloadSelected());

        // Select/Deselect All
        const selectAll = document.getElementById('selectAll');
        if (selectAll) selectAll.addEventListener('click', () => {
            document.querySelectorAll('#chaptersList input[type="checkbox"]').forEach(c => c.checked = true);
        });

        const deselectAll = document.getElementById('deselectAll');
        if (deselectAll) deselectAll.addEventListener('click', () => {
            document.querySelectorAll('#chaptersList input[type="checkbox"]').forEach(c => c.checked = false);
        });
    },

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'updateStatus') {
                UIManager.updateStatus(message.status);
                if (message.current !== undefined && message.total !== undefined) {
                    UIManager.updateProgress(message.current, message.total);
                }

                if (message.status.includes('Completed') || message.status.includes('Error')) {
                    UIManager.setButtonsDisabled(false);
                } else {
                    UIManager.setButtonsDisabled(true);
                }
            }
            return true;
        });
    },

    checkStatus() {
        chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
            if (response && response.status) {
                UIManager.updateStatus(response.status);
                if (response.current !== undefined && response.total !== undefined) {
                    UIManager.updateProgress(response.current, response.total);
                }

                if (response.inProgress) {
                    UIManager.setButtonsDisabled(true);
                }
            }
        });
    },

    async handleFetchChapters() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.url) {
            UIManager.updateStatus('Error: No active tab found.');
            return;
        }

        // Check if on a manga page (not a chapter reader page)
        if (!tab.url.includes('weebcentral.com') || tab.url.includes('/chapters/')) {
            UIManager.updateStatus('Navigate to a manga series page to fetch chapters.');
            return;
        }

        UIManager.updateStatus('Fetching chapters...');
        UIManager.setButtonsDisabled(true);

        try {
            const settings = await SettingsManager.getSettings();
            const scraper = new MangaScraper(settings);

            // Get manga title
            this.mangaTitle = await scraper.getMangaTitle(tab.url);

            // Get chapters from current tab
            const chapters = await scraper.getChapters(tab.url, tab.id);

            if (chapters.length === 0) {
                UIManager.updateStatus('No chapters found on this page.');
                UIManager.setButtonsDisabled(false);
                return;
            }

            this.allChapters = chapters;
            await this.saveState();

            // Display chapters in the UI
            this.displayChapters(chapters);
            UIManager.toggleChaptersView(true);
            UIManager.updateStatus(`Found ${chapters.length} chapters.`);
        } catch (error) {
            console.error('Error fetching chapters:', error);
            UIManager.updateStatus('Error: ' + error.message);
        } finally {
            UIManager.setButtonsDisabled(false);
        }
    },

    displayChapters(chapters) {
        const list = document.getElementById('chaptersList');
        if (!list) return;

        list.innerHTML = '';

        chapters.forEach((chapter, index) => {
            const item = document.createElement('label');
            item.className = 'chapter-item';
            item.innerHTML = `
                <input type="checkbox" value="${chapter.url}" checked>
                <span class="chapter-name">${chapter.name || 'Chapter ' + chapter.number}</span>
            `;
            list.appendChild(item);
        });
    },

    async handleDownloadSelected() {
        const checkboxes = document.querySelectorAll('#chaptersList input[type="checkbox"]:checked');

        if (checkboxes.length === 0) {
            UIManager.updateStatus('No chapters selected!');
            return;
        }

        const selectedUrls = Array.from(checkboxes).map(cb => cb.value);
        const selectedChapters = this.allChapters.filter(ch => selectedUrls.includes(ch.url));

        if (selectedChapters.length === 0) {
            UIManager.updateStatus('Error: Could not find selected chapters.');
            return;
        }

        UIManager.updateStatus(`Downloading ${selectedChapters.length} chapters...`);
        UIManager.setButtonsDisabled(true);
        UIManager.updateProgress(0, selectedChapters.length);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const settings = await SettingsManager.getSettings();
            const format = settings.downloadFormat || 'images';

            // Pass download format to the scraper settings
            const scraperSettings = {
                ...settings,
                downloadFormat: format
            };
            const scraper = new MangaScraper(scraperSettings);

            await scraper.downloadMangaSeries(tab.url, selectedChapters, (progress) => {
                UIManager.updateStatus(progress.status);
                UIManager.updateProgress(progress.current, progress.total);
            });

            UIManager.updateStatus(`Completed! Downloaded ${selectedChapters.length} chapters.`);
            UIManager.updateProgress(selectedChapters.length, selectedChapters.length);
        } catch (error) {
            console.error('Error downloading chapters:', error);
            UIManager.updateStatus('Error: ' + error.message);
        } finally {
            UIManager.setButtonsDisabled(false);
        }
    },
};
