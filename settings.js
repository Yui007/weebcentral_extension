import { UIManager } from './ui.js';

export const SettingsManager = {
    init() {
        this.loadSettings();
        this.setupListeners();
    },

    loadSettings() {
        chrome.storage.local.get(['downloadDelay', 'imageConcurrency', 'chapterConcurrency', 'downloadFormat'], (result) => {
            const delayInput = document.getElementById('downloadDelay');
            const imageConcurrencyInput = document.getElementById('imageConcurrency');
            const chapterConcurrencyInput = document.getElementById('chapterConcurrency');
            const downloadFormatSelect = document.getElementById('downloadFormat');

            if (delayInput) delayInput.value = result.downloadDelay !== undefined ? result.downloadDelay : 300;
            if (imageConcurrencyInput) imageConcurrencyInput.value = result.imageConcurrency !== undefined ? result.imageConcurrency : 3;
            if (chapterConcurrencyInput) chapterConcurrencyInput.value = result.chapterConcurrency !== undefined ? result.chapterConcurrency : 1;
            if (downloadFormatSelect) downloadFormatSelect.value = result.downloadFormat || 'images';
        });
    },

    getSettings() {
        return new Promise(resolve => {
            chrome.storage.local.get(['downloadDelay', 'imageConcurrency', 'chapterConcurrency', 'downloadFormat'], (result) => {
                resolve({
                    downloadDelay: result.downloadDelay || 300,
                    imageConcurrency: result.imageConcurrency || 3,
                    chapterConcurrency: result.chapterConcurrency || 1,
                    downloadFormat: result.downloadFormat || 'images'
                });
            });
        });
    },

    setupListeners() {
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }
    },

    saveSettings() {
        const delayInput = document.getElementById('downloadDelay');
        const imageConcurrencyInput = document.getElementById('imageConcurrency');
        const chapterConcurrencyInput = document.getElementById('chapterConcurrency');
        const downloadFormatSelect = document.getElementById('downloadFormat');

        // Safely get values with fallbacks
        const downloadDelay = delayInput ? parseInt(delayInput.value) : 300;
        const imageConcurrency = imageConcurrencyInput ? parseInt(imageConcurrencyInput.value) : 3;
        const chapterConcurrency = chapterConcurrencyInput ? parseInt(chapterConcurrencyInput.value) : 1;
        const downloadFormat = downloadFormatSelect ? downloadFormatSelect.value : 'images';

        // Validate downloadDelay
        if (isNaN(downloadDelay) || downloadDelay < 0 || downloadDelay > 5000) {
            UIManager.updateStatus('Error: Invalid delay (0-5000ms)');
            return;
        }

        // Validate imageConcurrency
        if (isNaN(imageConcurrency) || imageConcurrency < 1 || imageConcurrency > 10) {
            UIManager.updateStatus('Error: Invalid image concurrency (1-10)');
            return;
        }

        // Validate chapterConcurrency
        if (isNaN(chapterConcurrency) || chapterConcurrency < 1 || chapterConcurrency > 5) {
            UIManager.updateStatus('Error: Invalid chapter concurrency (1-5)');
            return;
        }

        chrome.storage.local.set({
            downloadDelay: downloadDelay,
            imageConcurrency: imageConcurrency,
            chapterConcurrency: chapterConcurrency,
            downloadFormat: downloadFormat
        }, () => {
            UIManager.updateStatus('Settings saved successfully!');
            setTimeout(() => {
                UIManager.updateStatus('Ready');
            }, 1500);
        });
    }
};
