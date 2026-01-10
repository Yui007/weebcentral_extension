// This script runs on weebcentral.com pages
console.log('WeebCentral Downloader extension loaded');

// Specific detection for weebcentral.com URLs
const isChapterPage =
  window.location.href.includes('/chapters/') || // Matches https://weebcentral.com/chapters/01J76XYSNJDQCG2T1AW43Z34Y1
  window.location.href.includes('/chapter/') ||
  window.location.href.includes('/read/');

console.log('WeebCentral Downloader - Is chapter page:', isChapterPage);

// Add a download button to chapter pages
if (isChapterPage) {
  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download Chapter';
  downloadBtn.style.position = 'fixed';
  downloadBtn.style.top = '10px';
  downloadBtn.style.right = '10px';
  downloadBtn.style.zIndex = '9999';
  downloadBtn.style.padding = '8px 12px';
  downloadBtn.style.backgroundColor = '#4CAF50';
  downloadBtn.style.color = 'white';
  downloadBtn.style.border = 'none';
  downloadBtn.style.borderRadius = '4px';
  downloadBtn.style.cursor = 'pointer';

  downloadBtn.addEventListener('click', async () => {
    console.log('Download button clicked');

    // Get download format from settings
    const settings = await chrome.storage.local.get(['downloadFormat', 'downloadDelay', 'imageConcurrency']);
    const downloadFormat = settings.downloadFormat || 'images';
    const downloadDelay = settings.downloadDelay || 300;

    // For weebcentral.com, extract manga name from page content
    let mangaName = 'unknown';
    let chapterNum = 'unknown';

    // Try to get manga name from breadcrumb or title
    const breadcrumb = document.querySelector('.breadcrumb a, .nav-breadcrumb a');
    if (breadcrumb) {
      mangaName = breadcrumb.textContent.trim();
    } else {
      // Try to get from title
      const title = document.querySelector('h1, .chapter-title, .title');
      if (title) {
        const titleText = title.textContent.trim();
        // Extract manga name from title (usually before "Chapter")
        const match = titleText.match(/(.*?)(?:Chapter|Ch\.)/i);
        if (match && match[1]) {
          mangaName = match[1].trim();
        } else {
          mangaName = titleText;
        }
      }
    }

    // Try to get chapter number from title
    const chapterTitle = document.querySelector('h1, .chapter-title, .title');
    if (chapterTitle) {
      const titleText = chapterTitle.textContent.trim();
      // Extract chapter number
      const match = titleText.match(/Chapter\s+(\d+\.?\d*)|Ch\.\s*(\d+\.?\d*)/i);
      if (match) {
        chapterNum = match[1] || match[2];
      }
    }

    // If we couldn't get chapter number from title, try from URL
    if (chapterNum === 'unknown') {
      const urlParts = window.location.pathname.split('/');
      if (urlParts.length > 0) {
        const lastPart = urlParts[urlParts.length - 1];
        if (lastPart) {
          chapterNum = lastPart.substring(0, 8);
        }
      }
    }

    console.log(`Detected manga: ${mangaName}, chapter: ${chapterNum}, format: ${downloadFormat}`);

    // Create folder name for downloads
    const folderName = `${mangaName}_ch${chapterNum}`.replace(/[\\/*?:"<>|]/g, '_');

    // Wait a bit for images to load fully
    setTimeout(() => {
      // Improved image selectors for weebcentral.com
      let images = [];

      const selectors = [
        'img[src*="/manga/"]',
        'img[src*="/chapters/"]',
        '.reader-content img',
        '.chapter-content img',
        '.manga-reader img',
        '.reader img',
        '.chapter img',
        'img[src*="chapter"]',
        'img[src*=".jpg"], img[src*=".png"], img[src*=".jpeg"]'
      ];

      for (const selector of selectors) {
        const found = Array.from(document.querySelectorAll(selector))
          .filter(img => img.src && img.width > 100);
        if (found.length > 0) {
          found.forEach(img => {
            if (!images.some(i => i.src === img.src)) images.push(img);
          });
        }
      }

      // Filter out unwanted images
      images = images.filter(img => {
        const src = img.src.toLowerCase();
        return !['avatar', 'icon', 'logo', 'banner', 'brand'].some(word => src.includes(word));
      });

      if (images.length === 0) {
        console.log('No manga images found on this page');
        return;
      }

      console.log(`Found ${images.length} images, downloading as ${downloadFormat}`);

      const imageUrls = images.map(img => img.src);

      // Choose download method based on format
      if (downloadFormat === 'pdf') {
        chrome.runtime.sendMessage({
          action: 'createSingleChapterPdf',
          urls: imageUrls,
          folderName: folderName,
          settings: { downloadDelay }
        });
      } else if (downloadFormat === 'zip') {
        chrome.runtime.sendMessage({
          action: 'createSingleChapterZip',
          urls: imageUrls,
          folderName: folderName,
          settings: { downloadDelay }
        });
      } else {
        // Default: individual images
        let downloadCount = 0;
        function downloadNext(index) {
          if (index >= images.length) {
            console.log(`Downloaded ${downloadCount} images`);
            return;
          }

          const imgUrl = images[index].src;
          const filename = `${folderName}/${(index + 1).toString().padStart(3, '0')}.jpg`;

          chrome.runtime.sendMessage({
            action: 'downloadImage',
            url: imgUrl,
            filename: filename
          }, (response) => {
            if (response && response.success) downloadCount++;
            setTimeout(() => downloadNext(index + 1), downloadDelay);
          });
        }
        downloadNext(0);
      }
    }, 2000);
  });

  document.body.appendChild(downloadBtn);
}
// This is a suggested addition to your content script that handles chapter scraping

// Function to ensure all chapters are visible before scraping
async function ensureAllChaptersVisible() {
  // Look for common "show all chapters" or "load more" buttons
  const showMoreSelectors = [
    'button',
    'a',
    '.show-more',
    '.load-more',
    '.view-all',
    '.view-more',
    '.btn-show-more'
  ];

  // Try each selector
  for (const selector of showMoreSelectors) {
    const elements = document.querySelectorAll(selector);

    for (const el of elements) {
      // Check if text contains relevant phrases
      const text = el.textContent.toLowerCase();
      if (text.includes('show all') ||
        text.includes('load more') ||
        text.includes('show all chapters') ||
        text.includes('view more')) {

        console.log('Found "show more" button, clicking it...', el);
        el.click();

        // Wait for new content to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if there are more "show more" buttons after clicking
        const moreButtons = document.querySelectorAll(selector);
        for (const btn of moreButtons) {
          const btnText = btn.textContent.toLowerCase();
          if ((btnText.includes('show all') ||
            btnText.includes('load more') ||
            btnText.includes('show all chapters') ||
            btnText.includes('view more')) &&
            btn !== el) {
            console.log('Found additional button, clicking it...', btn);
            btn.click();
            // Wait between clicks
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        // Final wait to ensure everything is loaded
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }
    }
  }

  console.log('No "show more" buttons found, all chapters should be visible');
  return true;
}

// Function to scrape chapter URLs
async function scrapeChapterUrls() {
  // First make sure all chapters are visible
  await ensureAllChaptersVisible();

  // Now scrape the chapter URLs
  // This is a generic approach - you'll need to customize based on the manga site's structure
  const chapterLinks = Array.from(document.querySelectorAll('a[href*="chapter"]'));

  // Filter and map to get clean chapter URLs
  const chapterUrls = chapterLinks
    .map(link => link.href)
    .filter(url => url && url.includes('chapter'));

  // Remove duplicates
  const uniqueChapterUrls = [...new Set(chapterUrls)];

  console.log(`Found ${uniqueChapterUrls.length} unique chapter URLs`);
  return uniqueChapterUrls;
}

// Function to extract chapter number from URL or text
function extractChapterNumber(url, text) {
  // Try to extract from URL first
  const urlMatch = url.match(/chapter[_-](\d+)/i) || url.match(/ch[_-](\d+)/i);
  if (urlMatch && urlMatch[1]) {
    return parseInt(urlMatch[1], 10);
  }

  // Try to extract from text
  if (text) {
    const textMatch = text.match(/chapter\s*(\d+)/i) || text.match(/ch\.\s*(\d+)/i);
    if (textMatch && textMatch[1]) {
      return parseInt(textMatch[1], 10);
    }
  }

  return null;
}

// Function to sort chapters by number
function sortChaptersByNumber(chapters) {
  return chapters.sort((a, b) => {
    const aNum = a.number || 0;
    const bNum = b.number || 0;
    return aNum - bNum;
  });
}

// Main function to get all chapters with proper numbering
async function getAllChapters() {
  const rawChapterUrls = await scrapeChapterUrls();

  // Process each URL to extract chapter number
  const chapters = rawChapterUrls.map(url => {
    const linkElement = Array.from(document.querySelectorAll('a')).find(a => a.href === url);
    const text = linkElement ? linkElement.textContent : '';
    const number = extractChapterNumber(url, text);

    return {
      url,
      text,
      number
    };
  });

  // Sort chapters by number
  const sortedChapters = sortChaptersByNumber(chapters);

  console.log('Sorted chapters:', sortedChapters);
  return sortedChapters;
}

// Example of how to use this in your extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchChapters') {
    getAllChapters().then(chapters => {
      sendResponse({ success: true, chapters });
    }).catch(error => {
      console.error('Error fetching chapters:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Indicates async response
  }
});

// Detect if we're on a manga listing page (not a chapter page)
const isMangaListingPage =
  !isChapterPage && // Not a chapter page
  (window.location.href.includes('/manga/') || // Common manga listing URL pattern
    window.location.href.includes('/series/') || // WeebCentral specific URL pattern
    document.querySelector('.chapter-list') !== null || // Has chapter list
    document.querySelector('.chapters-list') !== null || // Alternative class name
    document.querySelector('a[href*="chapter"]') !== null); // Has links to chapters

console.log('WeebCentral Downloader - Is manga listing page:', isMangaListingPage);

// We've removed the "Fetch All Chapters" button from the manga page
// This functionality is now available in the extension popup




