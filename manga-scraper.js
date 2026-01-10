// Manga scraper functionality for WeebCentral Downloader

// This function will be executed in the context of the manga page
// It needs to be defined outside the class to be properly serialized
function scrapeAllChaptersFromPage() {
  return new Promise(async (resolve) => {
    console.log("Scraping all chapters from page...");

    // First ensure all chapters are visible by clicking "show more" buttons
    await ensureAllChaptersVisible();

    // Now scrape the chapter URLs
    const chapters = await getAllChapters();

    resolve(chapters);
  });

  // Function to ensure all chapters are visible by clicking "show more" buttons
  async function ensureAllChaptersVisible() {
    console.log("Ensuring all chapters are visible...");

    // Common selectors for "show more" buttons
    const showMoreSelectors = [
      'button:not([disabled])',
      'a.button',
      'a.btn',
      'div.button',
      'div.btn',
      'span.button',
      'span.btn',
      '.load-more',
      '.show-more',
      '.view-more'
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
    // WeebCentral selectors based on user feedback
    // Chapters are direct children of #chapter-list or inside div.flex.items-center

    // First try the specific structure provided
    let chapterLinks = Array.from(document.querySelectorAll('#chapter-list > div.flex.items-center > a[href*="/chapters/"]'));

    if (chapterLinks.length === 0) {
      // Try slightly broader selector in #chapter-list
      chapterLinks = Array.from(document.querySelectorAll('#chapter-list a[href*="/chapters/"]'));
    }

    console.log(`Found ${chapterLinks.length} chapter links`);

    // Fallback search if still empty
    if (chapterLinks.length === 0) {
      console.log('No chapters found with primary selectors, trying alternatives...');
      chapterLinks = Array.from(document.querySelectorAll('a[href*="/chapters/"]'));
    }

    // Filter and map to get clean chapter URLs
    const chapterUrls = chapterLinks
      .map(link => link.href)
      .filter(url => url && url.includes('/chapters/'));

    // Remove duplicates
    const uniqueChapterUrls = [...new Set(chapterUrls)];

    console.log(`Found ${uniqueChapterUrls.length} unique chapter URLs`);
    return uniqueChapterUrls;
  }

  // Function to extract chapter number from URL or text
  function extractChapterNumber(url, text) {
    // Try to extract from URL first
    const urlPatterns = [
      /chapter[_\-](\d+(\.\d+)?)/i,
      /ch[_\-](\d+(\.\d+)?)/i,
      /\/chapter\/(\d+(\.\d+)?)/i,
      /\/ch\/(\d+(\.\d+)?)/i,
      /\/(\d+(\.\d+)?)$/,
      /\/chapters\/(\d+)/i
    ];

    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return parseFloat(match[1]);
      }
    }

    // For WeebCentral URLs like /chapters/01J76XYSNJDQCG2T1AW43Z34Y1
    // Try to extract from text since URL doesn't contain chapter number
    if (text) {
      // Look for "Chapter X" or "Ch. X" pattern
      const textPatterns = [
        /chapter\s*(\d+(\.\d+)?)/i,
        /ch\.\s*(\d+(\.\d+)?)/i,
        /ch\s+(\d+(\.\d+)?)/i,
        /^(\d+(\.\d+)?)$/,
        /episode\s*(\d+(\.\d+)?)/i,
        /ep\.\s*(\d+(\.\d+)?)/i,
        /ep\s+(\d+(\.\d+)?)/i
      ];

      for (const pattern of textPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          return parseFloat(match[1]);
        }
      }
    }

    // For sites that use numeric IDs in the URL path
    const pathParts = url.split('/').filter(part => part.length > 0);
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];
      // Check if this part is purely numeric
      if (/^\d+(\.\d+)?$/.test(part)) {
        return parseFloat(part);
      }
    }

    // For sites that use chapter numbers in query parameters
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;

      // Common query parameter names for chapter numbers
      const paramNames = ['chapter', 'ch', 'c', 'num', 'n'];

      for (const name of paramNames) {
        if (params.has(name)) {
          const value = params.get(name);
          if (/^\d+(\.\d+)?$/.test(value)) {
            return parseFloat(value);
          }
        }
      }
    } catch (e) {
      console.error('Error parsing URL:', e);
    }

    // If we still can't find a number, check if the URL contains any numbers
    const anyNumberMatch = url.match(/\/(\d+)(?:[^\d]|$)/);
    if (anyNumberMatch && anyNumberMatch[1]) {
      return parseFloat(anyNumberMatch[1]);
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
    // Now scrape the chapter URLs
    const chapterUrls = await scrapeChapterUrls();

    console.log(`Found ${chapterUrls.length} chapter URLs`);

    // Extract chapter information
    const chapters = [];

    // Get all chapter links with their text content from #chapter-list
    let chapterLinks = Array.from(document.querySelectorAll('#chapter-list a[href*="/chapters/"]'));

    // Fallback if #chapter-list not found
    if (chapterLinks.length === 0) {
      chapterLinks = Array.from(document.querySelectorAll('a[href*="/chapters/"]'));
    }

    console.log(`Found ${chapterLinks.length} chapter links with text content`);

    // Create a map of URLs to their text content
    // For WeebCentral, the chapter name is in span.grow > span:first-child
    const urlToTextMap = new Map();
    chapterLinks.forEach(link => {
      if (link.href) {
        // Try to get chapter name from span.grow > span:first-child
        const chapterNameSpan = link.querySelector('span.grow > span:first-child');
        let chapterText = '';

        if (chapterNameSpan) {
          chapterText = chapterNameSpan.textContent.trim();
        } else {
          // Fallback to full text content
          chapterText = link.textContent.trim();
        }

        urlToTextMap.set(link.href, chapterText);
      }
    });

    // Process each URL
    for (let i = 0; i < chapterUrls.length; i++) {
      const url = chapterUrls[i];
      let chapterName = '';
      let chapterNum = 0;

      // Find the element again to extract valid text
      // We look for the link with this specific URL
      const linkEl = document.querySelector(`a[href="${url.replace(window.location.origin, '')}"]`) ||
        document.querySelector(`a[href="${url}"]`);

      if (linkEl) {
        // Structure: a > span.grow > span (contains "Chapter X")
        const nameSpan = linkEl.querySelector('span.grow > span:first-child');
        if (nameSpan) {
          chapterName = nameSpan.textContent.trim();
        } else {
          // Fallback: try to find any text node in the link or span
          chapterName = linkEl.textContent.trim();
        }

        // Extract Number
        // First try strict "Chapter X" or number regex
        const numMatch = chapterName.match(/Chapter\s+(\d+(\.\d+)?)/i) ||
          chapterName.match(/^(\d+(\.\d+)?)$/);

        if (numMatch) {
          chapterNum = parseFloat(numMatch[1]);
        } else {
          // Fallback to URL extraction if name extraction fails
          chapterNum = extractChapterNumber(url, chapterName);
        }
      } else {
        // Fallback if element not found in DOM anymore (rare)
        chapterNum = extractChapterNumber(url, '');
        chapterName = `Chapter ${chapterNum}`;
      }

      // Final fallback for chapter number
      if (!chapterNum) chapterNum = 0;

      chapters.push({
        url: url,
        name: chapterName,
        number: chapterNum
      });

      console.log(`Processed: ${chapterName} (${chapterNum})`);
    }

    // Helper function to clean up chapter names
    function cleanChapterName(name) {
      if (!name) return '';

      // Remove SVG code
      name = name.replace(/\.st\d+\s*{\s*fill:[^}]+}/g, '');

      // Remove dates (like Sep 7, 2024)
      name = name.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/g, '');

      // Remove "Last Read" text
      name = name.replace(/Last Read/g, '');

      // Remove extra whitespace
      name = name.replace(/\s+/g, ' ').trim();

      return name;
    }

    // Sort chapters by number
    const sortedChapters = sortChaptersByNumber(chapters);

    console.log('Sorted chapters:', sortedChapters);
    return sortedChapters;
  }
}

class MangaScraper {
  constructor(settings = {}) {
    this.settings = {
      downloadDelay: settings.downloadDelay || 300,
      batchSize: settings.batchSize || 3,
      imageConcurrency: settings.imageConcurrency || 3,
      chapterConcurrency: settings.chapterConcurrency || 1,
      chapterDelay: settings.chapterDelay || 1000,
      downloadFormat: settings.downloadFormat || 'images',
      maxRetries: 3,
      retryDelay: 1000
    };
    this.baseUrl = 'https://weebcentral.com';
    this.stopFlag = false;

    // Keep track of chapters being processed to prevent duplicates
    this.processingChapters = new Set();
  }

  async fetchWithRetry(url, options = {}, retries = this.settings.maxRetries) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (retries > 0) {
        console.log(`Fetch failed, retrying (${retries} attempts left)...`);
        await new Promise(resolve => setTimeout(resolve, this.settings.retryDelay));
        return this.fetchWithRetry(url, options, retries - 1);
      } else {
        throw error;
      }
    }
  }

  getChapterListUrl(mangaUrl) {
    // For weebcentral.com, the chapter list is on the manga page
    return mangaUrl;
  }

  extractChapterNumber(chapterName) {
    // Try to extract chapter number from name
    const match = chapterName.match(/chapter\s+(\d+(\.\d+)?)/i);
    if (match) {
      return parseFloat(match[1]);
    }

    // Try other formats
    const numMatch = chapterName.match(/(\d+(\.\d+)?)/);
    if (numMatch) {
      return parseFloat(numMatch[1]);
    }

    return 0; // Default if no number found
  }

  async getMangaTitle(mangaUrl) {
    try {
      const response = await this.fetchWithRetry(mangaUrl);
      const text = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');

      // Try different selectors for the title
      const titleSelectors = [
        'h1.text-2xl', // Common selector for manga titles
        'h1', // Generic h1
        '.manga-title',
        '.series-title'
      ];

      for (const selector of titleSelectors) {
        const titleElement = doc.querySelector(selector);
        if (titleElement && titleElement.textContent.trim()) {
          return titleElement.textContent.trim();
        }
      }

      // Fallback: extract from URL
      const urlParts = mangaUrl.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      if (lastPart) {
        return lastPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }

      return "Unknown Manga";
    } catch (error) {
      console.error("Error getting manga title:", error);
      return "Unknown Manga";
    }
  }

  async getChapters(mangaUrl, tabId = null) {
    try {
      const chapterListUrl = this.getChapterListUrl(mangaUrl);
      console.log("Fetching chapter list from:", chapterListUrl);

      // Helper to execute script
      const executeScrape = async (targetTabId) => {
        return new Promise((resolve) => {
          chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: scrapeAllChaptersFromPage
          }, (results) => {
            if (results && results[0] && results[0].result) {
              const chapters = results[0].result;
              console.log(`Found ${chapters.length} unique chapters`);
              resolve(this.validateChapters(chapters));
            } else {
              console.error("Failed to scrape chapters");
              resolve([]);
            }
          });
        });
      };

      if (tabId) {
        // Use existing tab - fast path
        console.log("Scraping existing tab:", tabId);
        return await executeScrape(tabId);
      } else {
        // Create new tab - slow path (fallback)
        return new Promise((resolve) => {
          chrome.tabs.create({
            url: chapterListUrl,
            active: false
          }, async (tab) => {
            try {
              // Wait a moment for page load
              await new Promise(r => setTimeout(r, 3000));

              const chapters = await executeScrape(tab.id);
              chrome.tabs.remove(tab.id);
              resolve(chapters);
            } catch (error) {
              chrome.tabs.remove(tab.id);
              console.error("Error in getChapters (new tab):", error);
              resolve([]);
            }
          });
        });
      }
    } catch (error) {
      console.error("Error getting chapters:", error);
      return [];
    }
  }

  validateChapters(chapters) {
    return chapters.map(chapter => {
      if (!chapter.number || isNaN(chapter.number)) {
        console.warn(`Chapter has invalid number: ${chapter.name}, URL: ${chapter.url}`);
        const nameMatch = chapter.name.match(/chapter\s+(\d+(\.\d+)?)/i);
        if (nameMatch && nameMatch[1]) {
          chapter.number = parseFloat(nameMatch[1]);
        } else {
          chapter.number = 0;
        }
      }
      return chapter;
    });
  }

  parseChapterRange(chapterRange, chapters) {
    if (!chapterRange || chapterRange.trim() === '') {
      return chapters; // All chapters
    }

    let filteredChapters = [];

    if (chapterRange.includes('-')) {
      // Range of chapters
      const [start, end] = chapterRange.split('-').map(n => parseFloat(n.trim()));
      filteredChapters = chapters.filter(chapter =>
        chapter.number >= start && chapter.number <= end
      );
    } else {
      // Single chapter
      const targetNumber = parseFloat(chapterRange.trim());
      filteredChapters = chapters.filter(chapter => chapter.number === targetNumber);
    }

    // Ensure uniqueness by URL
    const uniqueFilteredChapters = [];
    const seenUrls = new Set();

    for (const chapter of filteredChapters) {
      if (!seenUrls.has(chapter.url)) {
        seenUrls.add(chapter.url);
        uniqueFilteredChapters.push(chapter);
      }
    }

    return uniqueFilteredChapters;
  }

  async downloadMangaSeries(mangaUrl, selectedChapters, progressCallback) {
    try {
      this.stopFlag = false;
      const mangaTitle = await this.getMangaTitle(mangaUrl);
      console.log(`Starting download for manga: ${mangaTitle}`);

      let totalProcessed = 0;
      let totalChapters = selectedChapters.length;

      // Clear the processing set at the start of a new download
      this.processingChapters.clear();

      // Process each chapter to collect images
      for (let i = 0; i < selectedChapters.length; i++) {
        if (this.stopFlag) {
          console.log("Download stopped by user");
          break;
        }

        const chapter = selectedChapters[i];

        // Skip if we've already processed this chapter URL
        if (this.processingChapters.has(chapter.url)) {
          console.log(`Skipping duplicate chapter: ${chapter.name} (${chapter.url})`);
          continue;
        }

        // Mark this chapter as being processed
        this.processingChapters.add(chapter.url);

        const chapterProgress = {
          current: i + 1,
          total: totalChapters,
          chapterName: chapter.name,
          mangaTitle: mangaTitle,
          status: `Processing chapter ${i + 1}/${totalChapters}: ${chapter.name}`
        };

        if (progressCallback) {
          progressCallback(chapterProgress);
        }

        console.log(`Processing chapter ${i + 1}/${totalChapters}: ${chapter.name} (${chapter.url})`);

        // Send message to background script to handle the chapter processing
        await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: 'downloadMangaChapter',
            chapterUrl: chapter.url,
            chapterName: chapter.name,
            mangaTitle: mangaTitle,
            settings: this.settings
          }, (response) => {
            if (response && response.success) {
              totalProcessed++;
            }
            resolve();
          });
        });

        // Wait between chapters to avoid overloading
        if (i < selectedChapters.length - 1) {
          await new Promise(resolve => setTimeout(resolve, this.settings.chapterDelay));
        }
      }

      // After all chapters are processed, download based on format setting
      if (totalProcessed > 0 && !this.stopFlag) {
        const format = this.settings.downloadFormat || 'images';

        if (progressCallback) {
          let formatText = format === 'pdf' ? 'PDF' : format === 'zip' ? 'ZIP' : 'images';
          progressCallback({
            current: totalChapters,
            total: totalChapters,
            mangaTitle: mangaTitle,
            status: `Creating ${formatText} file for ${totalProcessed} chapters...`
          });
        }

        // Send message to background script to create the final file
        await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: 'downloadPendingChapters',
            settings: this.settings,
            downloadFormat: format
          }, (response) => {
            resolve(response);
          });
        });
      }

      return {
        success: true,
        totalProcessed,
        totalChapters,
        mangaTitle
      };
    } catch (error) {
      console.error("Error downloading manga series:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  stopDownload() {
    this.stopFlag = true;
  }
}

// Make the class available globally
window.MangaScraper = MangaScraper;






