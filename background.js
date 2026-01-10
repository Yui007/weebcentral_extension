// Store download status and progress
let downloadStatus = {
  status: '',
  current: 0,
  total: 0,
  inProgress: false
};

// Track chapters being processed to prevent duplicates
const processingChapters = new Set();

// Track downloaded image URLs to prevent duplicates
const downloadedImages = new Set();

// Track ZIP downloads in progress to prevent duplicates
const zipDownloadsInProgress = new Set();

// Import JSZip library
importScripts('jszip.min.js');

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'downloadImage') {
    console.log(`Downloading image: ${message.url}`);
    console.log(`Filename: ${message.filename}`);

    // Check if we've already downloaded this image
    if (downloadedImages.has(message.url)) {
      console.log(`Skipping duplicate download: ${message.url}`);
      sendResponse({ success: false, error: 'Duplicate image' });
      return true;
    }

    // Mark this URL as downloaded
    downloadedImages.add(message.url);

    // Use chrome.downloads API to download the image
    try {
      chrome.downloads.download({
        url: message.url,
        filename: message.filename,
        saveAs: false,
        conflictAction: 'uniquify' // Ensure we don't overwrite existing files
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('Download error:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log(`Download started with ID: ${downloadId}`);
          sendResponse({ success: true, downloadId: downloadId });
        }
      });
    } catch (error) {
      console.error('Exception during download:', error);
      sendResponse({ success: false, error: error.message });
    }

    // Return true to indicate we'll send a response asynchronously
    return true;
  }

  // Handle direct ZIP download request
  if (message.action === 'downloadAsZip') {
    console.log(`Received request to create ZIP with ${message.urls.length} images`);
    console.log(`Folder name: ${message.folderName}`);
    console.log(`Is current chapter: ${message.isCurrentChapter ? 'Yes' : 'No'}`);

    // COMPLETELY NEW APPROACH: Create a fresh array with only unique URLs
    const uniqueUrlMap = new Map();

    // Process each URL and ensure uniqueness
    message.urls.forEach((url, index) => {
      if (url && !uniqueUrlMap.has(url)) {
        uniqueUrlMap.set(url, index);
      }
    });

    // Convert back to arrays
    const uniqueUrls = Array.from(uniqueUrlMap.keys());

    console.log(`DEDUPLICATION RESULTS: ${uniqueUrls.length} unique images from ${message.urls.length} total`);

    // Create fresh paths for each unique URL
    const uniquePaths = uniqueUrls.map((_, index) =>
      `${message.folderName}/${(index + 1).toString().padStart(3, '0')}.jpg`
    );

    // Send initial status update
    updateStatus(`Creating ZIP file with ${uniqueUrls.length} images...`, 0, uniqueUrls.length);

    // Create ZIP directly in the background script with ONLY the unique URLs
    createAndDownloadZip(
      uniqueUrls,
      uniquePaths,
      message.folderName,
      {
        downloadDelay: message.settings?.downloadDelay || 300,
        batchSize: message.settings?.batchSize || 3,
        isCurrentChapter: true // Force single chapter mode
      }
    );

    sendResponse({ success: true });
    return true;
  }

  // We've removed the fetchImageForZip handler since we now handle image fetching directly in the background script

  // Store status updates
  if (message.action === 'updateStatus') {
    // Store the status
    updateStatus(message.status, message.current, message.total);
    return true;
  }

  // Request for current status from popup
  if (message.action === 'getStatus') {
    sendResponse(downloadStatus);
    return true;
  }

  // We've removed the getZipData handler since we no longer use the zip-creator.html page

  // We've removed the zipComplete handler since we no longer use the zip-creator.html page

  // Handle chapters scraped from content script
  if (message.action === 'chaptersScraped') {
    console.log('Received scraped chapters:', message.chapters.length);

    // Store the chapters in extension storage
    chrome.storage.local.set({
      'mangaChapters': message.chapters,
      'lastScrapedTime': Date.now()
    }, () => {
      console.log('Chapters stored in extension storage');

      // Notify any open popup
      chrome.runtime.sendMessage({
        action: 'chaptersUpdated',
        count: message.chapters.length
      }).catch(() => {
        // Ignore errors if popup isn't open
        console.log('No popup open to receive chapter update');
      });

      sendResponse({ success: true });
    });

    return true; // Keep the message channel open for async response
  }

  // Handle manga chapter download request
  if (message.action === 'downloadMangaChapter') {
    // Create a unique key for this chapter
    const chapterKey = `${message.mangaTitle}:${message.chapterUrl}`;

    // Check if this chapter is already being processed
    if (processingChapters.has(chapterKey)) {
      console.log(`Chapter already being processed: ${message.chapterName} (${message.chapterUrl})`);
      sendResponse({ success: false, error: 'Chapter already being processed' });
      return true;
    }

    // Mark this chapter as being processed
    processingChapters.add(chapterKey);

    // Create folder name for the manga and chapter
    const mangaFolder = message.mangaTitle.replace(/[\\/*?:"<>|]/g, '_');
    const chapterFolder = message.chapterName.replace(/[\\/*?:"<>|]/g, '_');
    const folderPath = `${mangaFolder}/${chapterFolder}`;

    console.log(`Processing download request for chapter: ${message.chapterName}`);
    console.log(`Chapter URL: ${message.chapterUrl}`);

    // Update status
    updateStatus(`Downloading chapter: ${message.chapterName}`, 0, 1);

    // Create a new tab to load the chapter page
    chrome.tabs.create({
      url: message.chapterUrl,
      active: false
    }, (tab) => {
      console.log(`Created tab ${tab.id} for chapter: ${message.chapterName}`);

      // Execute script to extract images
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractChapterImages,
        args: [folderPath, message.settings]
      }, (results) => {
        // Try to close the tab after extraction attempt
        try {
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) {
              console.warn(`Error closing tab: ${chrome.runtime.lastError.message}`);
            } else {
              console.log(`Successfully closed tab ${tab.id}`);
            }
          });
        } catch (err) {
          console.error('Exception when closing tab:', err);
        }

        // Remove from processing set when done
        processingChapters.delete(chapterKey);

        if (results && results[0] && results[0].result && results[0].result.success) {
          console.log(`Successfully extracted images for chapter: ${message.chapterName}`);

          // Get the image URLs from the result
          const imageUrls = results[0].result.imageUrls;
          console.log(`Got ${imageUrls.length} images for chapter: ${message.chapterName}`);

          // Create a ZIP file with the images
          chrome.storage.local.get(['pendingChapterImages'], (data) => {
            // Initialize or update the pending images object
            const pendingImages = data.pendingChapterImages || {};

            // Add this chapter's images to the pending images
            pendingImages[folderPath] = imageUrls;

            // Store the updated pending images
            chrome.storage.local.set({ 'pendingChapterImages': pendingImages }, () => {
              console.log(`Stored ${imageUrls.length} images for chapter: ${message.chapterName}`);
              sendResponse({ success: true });
            });
          });
        } else {
          console.error(`Failed to extract images for chapter: ${message.chapterName}`);
          sendResponse({ success: false, error: 'Failed to extract images' });
        }
      });
    });

    return true; // Indicate we'll send a response asynchronously
  }

  // Handle request to download all pending chapter images based on format setting
  // Each chapter gets its own folder/file
  if (message.action === 'downloadPendingChapters') {
    chrome.storage.local.get(['pendingChapterImages'], async (data) => {
      const pendingImages = data.pendingChapterImages || {};
      const chapters = Object.keys(pendingImages);

      if (chapters.length === 0) {
        sendResponse({ success: false, error: 'No pending chapters to download' });
        return;
      }

      const downloadFormat = message.downloadFormat || message.settings?.downloadFormat || 'images';
      console.log(`Downloading ${chapters.length} chapters as separate ${downloadFormat} files`);

      const settings = message.settings || {
        downloadDelay: 300,
        batchSize: 3
      };

      // Process each chapter separately
      for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
        const chapterPath = chapters[chapterIndex];
        const chapterImages = pendingImages[chapterPath];

        // chapterPath is like "MangaTitle/Chapter 1"
        const pathParts = chapterPath.split('/');
        const mangaTitle = pathParts[0];
        const chapterName = pathParts.slice(1).join('/') || `Chapter ${chapterIndex + 1}`;

        // Create image objects for this chapter
        const chapterImageObjects = chapterImages.map((url, index) => ({
          url: url,
          path: `${chapterPath}/${(index + 1).toString().padStart(3, '0')}.jpg`
        }));

        updateStatus(`Processing chapter ${chapterIndex + 1}/${chapters.length}: ${chapterName}...`, chapterIndex, chapters.length);

        if (downloadFormat === 'pdf') {
          // Create PDF for this chapter
          updateStatus(`Creating PDF for ${chapterName}...`, chapterIndex, chapters.length);
          await createAndDownloadPdf(
            chapterImages,
            chapterPath, // Full path: MangaTitle/ChapterName
            settings
          );
          // Wait a bit between chapters
          await new Promise(r => setTimeout(r, 1000));
        } else if (downloadFormat === 'zip') {
          // Create ZIP for this chapter
          updateStatus(`Creating ZIP for ${chapterName}...`, chapterIndex, chapters.length);
          await createAndDownloadZip(
            chapterImages,
            chapterImages.map((_, i) => `${chapterPath}/${(i + 1).toString().padStart(3, '0')}.jpg`),
            chapterPath, // Full path: MangaTitle/ChapterName
            settings
          );
          // Wait a bit between chapters
          await new Promise(r => setTimeout(r, 1000));
        } else {
          // Download as individual images in chapter folder
          updateStatus(`Downloading images for ${chapterName}...`, chapterIndex, chapters.length);
          await downloadIndividualImages(chapterImageObjects, settings);
        }
      }

      updateStatus(`Completed! Downloaded ${chapters.length} chapters.`, chapters.length, chapters.length);

      // Clear the pending chapters after all downloads
      chrome.storage.local.remove('pendingChapterImages');

      sendResponse({ success: true });
    });

    return true; // Indicate we'll send a response asynchronously
  }

  // Handle SINGLE CHAPTER ZIP download request (new action)
  if (message.action === 'createSingleChapterZip') {
    console.log(`Received request to create SINGLE CHAPTER ZIP with ${message.urls.length} images`);
    console.log(`Folder name: ${message.folderName}`);

    // Check if we're already processing this folder
    if (zipDownloadsInProgress.has(message.folderName)) {
      console.log(`ZIP download already in progress for ${message.folderName}, ignoring duplicate request`);
      sendResponse({ success: false, error: 'ZIP download already in progress' });
      return true;
    }

    // Mark this folder as being processed
    zipDownloadsInProgress.add(message.folderName);

    // Deduplicate URLs
    const uniqueUrls = [...new Set(message.urls)];

    console.log(`After deduplication: ${uniqueUrls.length} unique URLs (was ${message.urls.length})`);

    // Create simple sequential paths
    const uniquePaths = uniqueUrls.map((_, index) =>
      `${message.folderName}/${(index + 1).toString().padStart(3, '0')}.jpg`
    );

    // Send initial status update
    updateStatus(`Creating ZIP file with ${uniqueUrls.length} images...`, 0, uniqueUrls.length);

    // Create a new function specifically for single chapter ZIP creation
    createSingleChapterZip(
      uniqueUrls,
      uniquePaths,
      message.folderName,
      message.settings || {
        downloadDelay: 300,
        batchSize: 3
      }
    ).finally(() => {
      // Remove from in-progress set when done
      zipDownloadsInProgress.delete(message.folderName);
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle SINGLE CHAPTER PDF download request
  if (message.action === 'createSingleChapterPdf') {
    console.log(`Received request to create SINGLE CHAPTER PDF with ${message.urls.length} images`);
    console.log(`Folder name: ${message.folderName}`);

    // Deduplicate URLs
    const uniqueUrls = [...new Set(message.urls)];
    console.log(`After deduplication: ${uniqueUrls.length} unique URLs`);

    // Send initial status update
    updateStatus(`Creating PDF file with ${uniqueUrls.length} images...`, 0, uniqueUrls.length);

    // Use the PDF generator (same as batch PDF)
    createAndDownloadPdf(
      uniqueUrls,
      message.folderName,
      message.settings || { downloadDelay: 300 }
    );

    sendResponse({ success: true });
    return true;
  }
});

// Helper function to update status and broadcast to all extension pages
function updateStatus(status, current, total) {
  // Update local status
  downloadStatus.status = status;
  if (current !== undefined && total !== undefined) {
    downloadStatus.current = current;
    downloadStatus.total = total;
  }
  downloadStatus.inProgress = !status.includes('Completed') &&
    !status.includes('Error');

  // Forward to all extension pages
  try {
    chrome.runtime.sendMessage({
      action: 'updateStatus',
      status: status,
      current: current,
      total: total
    }).catch(error => {
      // Suppress errors about disconnected message ports
      if (!error.message.includes('message port closed')) {
        console.warn('Non-critical error forwarding status update:', error.message);
      }
    });
  } catch (error) {
    // This is a non-critical error, just log it
    console.warn('Exception when forwarding status update:', error.message);
  }
}

// Function to extract images from a chapter page
function extractChapterImages(folderPath, settings) {
  console.log('Extracting images from chapter page...');
  console.log('Folder path:', folderPath);
  console.log('Settings:', settings);

  return new Promise((resolve) => {
    // Wait for page to load fully
    setTimeout(() => {
      // Improved image selectors for weebcentral.com
      let images = [];

      // Common selectors for manga sites, prioritizing weebcentral.com selectors
      const selectors = [
        'img[src*="/manga/"]',  // Key selector from your Python script
        'img[src*="/chapters/"]', // Another possible weebcentral.com pattern
        '.reader-content img',
        '.chapter-content img',
        '.manga-reader img',
        '.reader img',
        '.chapter img',
        '.container img[src*="chapter"]',
        'img[src*="chapter"]',
        'img[src*=".jpg"], img[src*=".png"], img[src*=".jpeg"]'
      ];

      // Create a Map to store unique images by URL
      const uniqueImages = new Map();

      // Try each selector
      for (const selector of selectors) {
        console.log(`Trying selector: ${selector}`);
        const found = Array.from(document.querySelectorAll(selector))
          .filter(img => img.src && img.width > 100);

        console.log(`Found ${found.length} images with selector: ${selector}`);

        // Add to our unique images Map
        found.forEach(img => {
          if (!uniqueImages.has(img.src)) {
            uniqueImages.set(img.src, img);
          }
        });
      }

      // Convert Map to Array
      images = Array.from(uniqueImages.values());

      // Filter out unwanted images (like avatars, icons, etc.)
      images = images.filter(img => {
        const src = img.src.toLowerCase();
        return !['avatar', 'icon', 'logo', 'banner', 'brand'].some(word => src.includes(word));
      });

      console.log(`Final image count after filtering: ${images.length}`);

      if (images.length === 0) {
        chrome.runtime.sendMessage({
          action: 'updateStatus',
          status: 'Error: No manga images found on this page'
        });
        resolve({ success: false, error: 'No images found' });
        return;
      }

      // Return the image URLs instead of starting a download
      const imageUrls = images.map(img => img.src).filter(url => url);
      resolve({
        success: true,
        imageCount: imageUrls.length,
        imageUrls: imageUrls
      });
    }, 3000); // Wait 3 seconds for images to load
  });
}

// Function to create and download a ZIP file directly in the background script
async function createAndDownloadZip(urls, paths, folderName, settings) {
  try {
    console.log('Starting ZIP creation process in background');
    console.log(`Original URLs count: ${urls.length}`);

    // Use settings or defaults
    const downloadDelay = settings?.downloadDelay || 300;

    console.log(`Using settings: delay=${downloadDelay}ms`);

    // First, deduplicate URLs to ensure we don't process the same image twice
    const uniqueUrls = [];
    const uniquePaths = [];
    const urlSet = new Set();

    // Create arrays of unique URLs and their corresponding paths
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (url && !urlSet.has(url)) {
        urlSet.add(url);
        uniqueUrls.push(url);
        if (paths && paths[i]) {
          uniquePaths.push(paths[i]);
        } else {
          uniquePaths.push(`${folderName}/${(uniqueUrls.length).toString().padStart(3, '0')}.jpg`);
        }
      }
    }

    console.log(`After deduplication: ${uniqueUrls.length} unique URLs (was ${urls.length})`);

    // IMPORTANT: If this is a single chapter download (indicated by a flag in the message),
    // make sure we're not creating multiple chapter folders
    if (settings && settings.isCurrentChapter) {
      console.log('Single chapter download detected - ensuring consistent folder structure');
      // Make sure all paths use the same folder structure
      for (let i = 0; i < uniquePaths.length; i++) {
        uniquePaths[i] = `${folderName}/${(i + 1).toString().padStart(3, '0')}.jpg`;
      }
    }

    // Send initial progress update
    updateStatus(`Creating ZIP file with ${uniqueUrls.length} images...`, 0, uniqueUrls.length);

    // Create a new JSZip instance
    const zip = new JSZip();
    let downloadedCount = 0;
    let failedCount = 0;

    // Process images sequentially to avoid any possibility of duplicates
    for (let i = 0; i < uniqueUrls.length; i++) {
      const url = uniqueUrls[i];
      const path = uniquePaths[i];

      try {
        // Send progress update
        updateStatus(`Adding image ${i + 1}/${uniqueUrls.length} to ZIP...`, i, uniqueUrls.length);
        console.log(`Processing image ${i + 1}/${uniqueUrls.length}: ${url}`);
        console.log(`Using path: ${path}`);

        // Try to fetch the image
        let blob = null;

        // First try direct fetch
        blob = await fetchImageAsBlob(url);

        // If that fails, try XHR as last resort
        if (!blob) {
          blob = await xhrFetchAsBlob(url);
        }

        // If all methods fail, create a fallback image
        if (!blob) {
          try {
            console.log('Creating fallback image for: ' + url);
            // Create a simple placeholder
            const byteArray = new Uint8Array([
              0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
              0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00,
              0x00, 0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
              0x44, 0x01, 0x00, 0x3B
            ]); // This is a minimal valid GIF

            blob = new Blob([byteArray], { type: 'image/gif' });
            console.log('Created fallback image for: ' + url);
          } catch (err) {
            console.warn('Failed to create fallback image:', err);
          }
        }

        if (blob) {
          // Add the image to the ZIP file
          try {
            zip.file(path, blob);
            downloadedCount++;
            console.log(`Successfully added image ${i + 1} to ZIP as ${path}`);
          } catch (error) {
            console.error(`Error adding file to ZIP: ${error.message}`);
            failedCount++;
          }
        } else {
          console.error(`All fetch methods failed for: ${url}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`Error processing image ${i + 1}:`, error);
        failedCount++;
      }

      // Brief pause between images to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, downloadDelay));
    }

    // Send progress update
    updateStatus(`Generating ZIP file...`, uniqueUrls.length, uniqueUrls.length);

    // Generate the ZIP file
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (metadata) => {
      // Update progress during ZIP generation
      const percent = metadata.percent.toFixed(1);
      updateStatus(`Compressing ZIP file: ${percent}%`, uniqueUrls.length, uniqueUrls.length);
    });

    // In Manifest V3 service workers, we can't use URL.createObjectURL directly
    // Instead, we'll use the downloads API with a data URL

    // Convert the blob to a data URL
    const reader = new FileReader();
    reader.onload = function () {
      const dataUrl = reader.result;

      // Use the downloads API to download the file
      chrome.downloads.download({
        url: dataUrl,
        filename: `${folderName}.zip`,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('Download error:', chrome.runtime.lastError);
          updateStatus(`Error: ${chrome.runtime.lastError.message}`, uniqueUrls.length, uniqueUrls.length);
        } else {
          console.log(`ZIP download started with ID: ${downloadId}`);
        }
      });
    };

    // Read the blob as a data URL
    reader.readAsDataURL(zipBlob);

    // Determine status message based on success/failure
    let statusMessage;
    if (failedCount === 0) {
      statusMessage = `Completed! Downloaded ${downloadedCount} unique images to ${folderName}.zip`;
    } else {
      statusMessage = `Completed with issues. Downloaded ${downloadedCount} images, failed to download ${failedCount} images.`;
    }

    updateStatus(statusMessage, uniqueUrls.length, uniqueUrls.length);

  } catch (error) {
    console.error('Error creating ZIP:', error);
    updateStatus(`Error creating ZIP file: ${error.message}`, 0, 1);
  }
}

// Function to create a ZIP file for a single chapter
async function createSingleChapterZip(urls, paths, folderName, settings) {
  try {
    console.log('Starting SINGLE CHAPTER ZIP creation process');
    console.log(`Processing ${urls.length} URLs`);

    // Use settings or defaults
    const downloadDelay = settings?.downloadDelay || 300;
    console.log(`Using settings: delay=${downloadDelay}ms`);

    // Send initial progress update
    updateStatus(`Creating ZIP file with ${urls.length} images...`, 0, urls.length);

    // Create a new JSZip instance
    const zip = new JSZip();
    let downloadedCount = 0;
    let failedCount = 0;

    // Process images sequentially
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const path = paths[i];

      try {
        // Send progress update
        updateStatus(`Adding image ${i + 1}/${urls.length} to ZIP...`, i, urls.length);
        console.log(`Processing image ${i + 1}/${urls.length}: ${url}`);

        // Try to fetch the image
        let blob = null;

        // First try direct fetch
        blob = await fetchImageAsBlob(url);

        // If that fails, try XHR as last resort
        if (!blob) {
          blob = await xhrFetchAsBlob(url);
        }

        // If all methods fail, create a fallback image
        if (!blob) {
          try {
            console.log('Creating fallback image for: ' + url);
            // Create a simple placeholder
            const byteArray = new Uint8Array([
              0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
              0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00,
              0x00, 0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
              0x44, 0x01, 0x00, 0x3B
            ]); // This is a minimal valid GIF

            blob = new Blob([byteArray], { type: 'image/gif' });
            console.log('Created fallback image for: ' + url);
          } catch (err) {
            console.warn('Failed to create fallback image:', err);
          }
        }

        if (blob) {
          // Add the image to the ZIP file
          try {
            zip.file(path, blob);
            downloadedCount++;
            console.log(`Successfully added image ${i + 1} to ZIP as ${path}`);
          } catch (error) {
            console.error(`Error adding file to ZIP: ${error.message}`);
            failedCount++;
          }
        } else {
          console.error(`All fetch methods failed for: ${url}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`Error processing image ${i + 1}:`, error);
        failedCount++;
      }

      // Brief pause between images
      await new Promise(resolve => setTimeout(resolve, downloadDelay));
    }

    // Send progress update
    updateStatus(`Generating ZIP file...`, urls.length, urls.length);

    // Generate the ZIP file
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (metadata) => {
      // Update progress during ZIP generation
      const percent = metadata.percent.toFixed(1);
      updateStatus(`Compressing ZIP file: ${percent}%`, urls.length, urls.length);
    });

    // Convert the blob to a data URL
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = function () {
        const dataUrl = reader.result;

        // Use the downloads API to download the file
        chrome.downloads.download({
          url: dataUrl,
          filename: `${folderName}.zip`,
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Download error:', chrome.runtime.lastError);
            updateStatus(`Error: ${chrome.runtime.lastError.message}`, urls.length, urls.length);
            reject(chrome.runtime.lastError);
          } else {
            console.log(`ZIP download started with ID: ${downloadId}`);

            // Determine status message based on success/failure
            let statusMessage;
            if (failedCount === 0) {
              statusMessage = `Completed! Downloaded ${downloadedCount} images to ${folderName}.zip`;
            } else {
              statusMessage = `Completed with issues. Downloaded ${downloadedCount} images, failed to download ${failedCount} images.`;
            }

            updateStatus(statusMessage, urls.length, urls.length);
            resolve(downloadId);
          }
        });
      };

      reader.onerror = function () {
        console.error('Error reading ZIP blob as data URL');
        updateStatus(`Error creating ZIP file: Failed to read ZIP data`, 0, 1);
        reject(reader.error);
      };

      // Read the blob as a data URL
      reader.readAsDataURL(zipBlob);
    });

  } catch (error) {
    console.error('Error creating ZIP:', error);
    updateStatus(`Error creating ZIP file: ${error.message}`, 0, 1);
    throw error; // Re-throw to be caught by the caller
  }
}

// Helper function to extract chapter information from URL
function extractChapterInfo(url, index) {
  try {
    // Try to extract chapter number from URL
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);

    // Look for chapter indicators in the URL
    for (let i = 0; i < pathParts.length; i++) {
      // Check for common chapter patterns like "chapter-123" or "ch-123"
      if (pathParts[i].match(/chapter-\d+/i) || pathParts[i].match(/ch-\d+/i)) {
        const chapterMatch = pathParts[i].match(/\d+/);
        if (chapterMatch) {
          return { chapter: chapterMatch[0] };
        }
      }
    }

    // If we couldn't extract from URL, try to infer from the index
    // This assumes URLs are grouped by chapter
    return { chapter: Math.floor(index / 20) + 1 }; // Assume ~20 images per chapter
  } catch (error) {
    console.warn('Error extracting chapter info:', error);
    return null;
  }
}

// Function to fetch an image as a blob
function fetchImageAsBlob(url) {
  return new Promise((resolve) => {
    console.log(`Trying direct fetch for: ${url}`);

    // Try with fetch API
    fetch(url, {
      method: 'GET',
      mode: 'no-cors', // Important for cross-origin requests
      cache: 'no-cache',
      credentials: 'include', // Include cookies
      headers: {
        'Accept': 'image/jpeg, image/png, image/webp, image/*',
        'Referer': new URL(url).origin,
        'Cache-Control': 'no-cache'
      },
      referrerPolicy: 'origin',
    })
      .then(response => {
        // In no-cors mode, we'll get an opaque response
        return response.blob();
      })
      .then(blob => {
        // Check if the blob is valid (has size)
        if (blob.size > 0) {
          console.log(`Direct fetch succeeded for: ${url}`);
          resolve(blob);
        } else {
          console.warn(`Direct fetch returned empty blob for: ${url}`);
          resolve(null);
        }
      })
      .catch(error => {
        console.warn(`Direct fetch failed for ${url}: ${error.message}`);
        resolve(null);
      });

    // Set a timeout for the fetch operation
    setTimeout(() => {
      console.warn(`Direct fetch timed out for: ${url}`);
      resolve(null);
    }, 30000); // 30 second timeout
  });
}

// XHR method as last resort
function xhrFetchAsBlob(url) {
  return new Promise((resolve) => {
    console.log(`Trying XHR fetch for: ${url}`);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = 30000; // 30 second timeout

    xhr.onload = function () {
      if (this.status === 200) {
        // Check if the blob is valid (has size)
        if (this.response && this.response.size > 0) {
          console.log(`XHR fetch succeeded for: ${url}`);
          resolve(this.response);
        } else {
          console.warn(`XHR fetch returned empty blob for: ${url}`);
          resolve(null);
        }
      } else {
        console.warn(`XHR fetch HTTP error for ${url}: ${this.status}`);
        resolve(null);
      }
    };

    xhr.onerror = function () {
      console.warn(`XHR fetch network error for: ${url}`);
      resolve(null);
    };

    xhr.ontimeout = function () {
      console.warn(`XHR fetch timed out for: ${url}`);
      resolve(null);
    };

    // Add some custom headers that might help
    try {
      xhr.setRequestHeader('Accept', 'image/jpeg, image/png, image/webp, image/*');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.setRequestHeader('Referer', new URL(url).origin);
    } catch (e) {
      console.warn(`Error setting XHR headers: ${e.message}`);
    }

    try {
      xhr.send();
    } catch (e) {
      console.warn(`Error sending XHR request: ${e.message}`);
      resolve(null);
    }
  });
}

// Function to create and download a PDF file from images
async function createAndDownloadPdf(urls, folderName, settings) {
  try {
    console.log('Starting PDF creation process');
    console.log(`Processing ${urls.length} images`);

    // Deduplicate URLs
    const uniqueUrls = [...new Set(urls)];
    console.log(`After deduplication: ${uniqueUrls.length} unique URLs`);

    updateStatus(`Opening PDF generator for ${uniqueUrls.length} images...`, 0, uniqueUrls.length);

    // Store only the URLs (small data, won't hit quota)
    // The PDF generator page will fetch images itself
    await chrome.storage.local.set({
      pdfGeneratorData: {
        imageUrls: uniqueUrls,
        folderName: folderName
      }
    });

    // Open our dedicated PDF generator page (works regardless of active tab)
    console.log('Opening PDF generator page...');
    chrome.tabs.create({
      url: chrome.runtime.getURL('pdf-generator.html'),
      active: false
    });

  } catch (error) {
    console.error('Error creating PDF:', error);
    updateStatus(`Error creating PDF: ${error.message}`, 0, 1);
  }
}

// Helper to convert blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}


// Function to download images individually (not as ZIP or PDF)
async function downloadIndividualImages(allImages, settings) {
  try {
    console.log('Starting individual image downloads');
    console.log(`Processing ${allImages.length} images`);

    const downloadDelay = settings?.downloadDelay || 300;
    let downloadedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < allImages.length; i++) {
      const image = allImages[i];

      updateStatus(`Downloading image ${i + 1}/${allImages.length}...`, i, allImages.length);

      try {
        await new Promise((resolve) => {
          chrome.downloads.download({
            url: image.url,
            filename: image.path,
            saveAs: false,
            conflictAction: 'uniquify'
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('Download error:', chrome.runtime.lastError);
              failedCount++;
            } else {
              console.log(`Download started: ${image.path}`);
              downloadedCount++;
            }
            resolve();
          });
        });
      } catch (error) {
        console.error(`Error downloading image ${i + 1}:`, error);
        failedCount++;
      }

      // Brief pause between downloads
      await new Promise(resolve => setTimeout(resolve, downloadDelay));
    }

    // Final status
    let statusMessage;
    if (failedCount === 0) {
      statusMessage = `Completed! Downloaded ${downloadedCount} images.`;
    } else {
      statusMessage = `Completed with issues. Downloaded ${downloadedCount} images, failed: ${failedCount}`;
    }

    updateStatus(statusMessage, allImages.length, allImages.length);
  } catch (error) {
    console.error('Error downloading images:', error);
    updateStatus(`Error downloading images: ${error.message}`, 0, 1);
  }
}
