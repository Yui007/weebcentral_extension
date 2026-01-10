const statusEl = document.getElementById('status');
const progressBar = document.getElementById('progressBar');

function updateStatus(text, current, total) {
    statusEl.textContent = text;
    if (current !== undefined && total !== undefined && total > 0) {
        progressBar.style.width = `${(current / total) * 100}%`;
    }
}

// Fetch an image and convert to base64
async function fetchImageAsBase64(url) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error fetching image:', url, error);
        return null;
    }
}

async function generatePdf() {
    try {
        // Get the PDF data from storage (only URLs and folderName, not base64)
        const data = await chrome.storage.local.get('pdfGeneratorData');
        if (!data.pdfGeneratorData) {
            updateStatus('Error: No PDF data found');
            return;
        }

        const { imageUrls, folderName } = data.pdfGeneratorData;

        // Clear the data immediately
        await chrome.storage.local.remove('pdfGeneratorData');

        if (!imageUrls || imageUrls.length === 0) {
            updateStatus('Error: No images to process');
            return;
        }

        const total = imageUrls.length;
        updateStatus(`Creating PDF with ${total} pages...`, 0, total);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'px',
            format: 'a4',
            compress: true
        });

        let pageAdded = false;
        let successCount = 0;

        // Fetch and add images one at a time to avoid memory issues
        for (let i = 0; i < total; i++) {
            updateStatus(`Fetching & adding page ${i + 1}/${total}...`, i + 1, total);

            // Send progress to background
            chrome.runtime.sendMessage({
                action: 'updateStatus',
                status: `PDF: Adding page ${i + 1}/${total}...`,
                current: i + 1,
                total: total
            }).catch(() => { });

            try {
                // Fetch the image
                const base64Data = await fetchImageAsBase64(imageUrls[i]);

                if (!base64Data) {
                    console.warn(`Skipping image ${i + 1} - fetch failed`);
                    continue;
                }

                // Create an image to get dimensions
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = base64Data;
                });

                if (pageAdded) doc.addPage();
                pageAdded = true;

                const pageWidth = doc.internal.pageSize.getWidth();
                const pageHeight = doc.internal.pageSize.getHeight();

                const scale = Math.min(pageWidth / img.width, pageHeight / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                const x = (pageWidth - w) / 2;
                const y = (pageHeight - h) / 2;

                doc.addImage(base64Data, 'JPEG', x, y, w, h);
                successCount++;

                // Small delay to let UI update and prevent overwhelming
                await new Promise(r => setTimeout(r, 50));
            } catch (err) {
                console.error('Error adding image ' + i + ' to PDF:', err);
            }
        }

        if (successCount === 0) {
            updateStatus('Error: Could not fetch any images');
            return;
        }

        updateStatus('Saving PDF...', total, total);

        // Save the PDF
        const filename = `${folderName}.pdf`;
        doc.save(filename);

        updateStatus(`PDF Downloaded! (${successCount} pages)`, total, total);

        // Notify background
        chrome.runtime.sendMessage({
            action: 'updateStatus',
            status: `PDF Downloaded! (${successCount} pages)`,
            current: total,
            total: total
        }).catch(() => { });

        // Close this tab after a short delay
        setTimeout(() => {
            window.close();
        }, 2000);

    } catch (error) {
        console.error('PDF generation error:', error);
        updateStatus('Error: ' + error.message);
        chrome.runtime.sendMessage({
            action: 'updateStatus',
            status: 'Error: ' + error.message
        }).catch(() => { });
    }
}

// Start generation when page loads
document.addEventListener('DOMContentLoaded', generatePdf);
