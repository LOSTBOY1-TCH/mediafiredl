const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json()) // Add middleware to parse JSON request bodies

function isValidMediafireURL(url) {
  return /^https?:\/\/(www\.)?mediafire\.com\/file\/.+/.test(url)
}

// Helper function to extract the direct link
async function extractDirectLink(fileUrl) {
  let browser;
  try {
    const executablePath = await chromium.executablePath || '/tmp/chromium'; // Added fallback
    console.log("Chromium Executable Path:", executablePath); // Add this line for debugging

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    const page = await browser.newPage();
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' }); // Wait for the DOM to be loaded

    // Wait for the download button to appear with a non-javascript href or data-scrambled-url
    await page.waitForFunction(
      () => {
        const downloadButton = document.querySelector('a#downloadButton');
        if (downloadButton) {
          const href = downloadButton.getAttribute('href');
          const scrambledUrl = downloadButton.getAttribute('data-scrambled-url');
          return (href && !href.startsWith('javascript:')) || scrambledUrl;
        }
        return false;
      },
      { timeout: 30000 } // Wait up to 30 seconds for the button
    );

    const directLink = await page.evaluate(() => {
      const downloadButton = document.querySelector('a#downloadButton');
      if (downloadButton) {
        let link = downloadButton.getAttribute('href');
        const scrambledUrl = downloadButton.getAttribute('data-scrambled-url');

        if (scrambledUrl) {
          try {
            // Base64 decoding in browser context
            link = atob(scrambledUrl);
          } catch (e) {
            console.error("Failed to decode data-scrambled-url in browser context:", e);
          }
        }

        // Fallback to script content if link is still javascript: or empty
        if (!link || link.startsWith('javascript:')) {
          const scriptContent = document.body.innerText; // Get all text content
          const match = scriptContent.match(/"downloadUrl":"(https?:\/\/[^"]+)"/);
          if (match && match[1]) {
            link = match[1].replace(/\\u002d/g, "-");
          }
        }

        return link;
      }
      return null;
    });

    if (!directLink || directLink.startsWith("javascript:") || !/^https?:\/\//.test(directLink)) {
      return null; // No valid direct link found after all attempts
    }

    return directLink;
  } catch (err) {
    console.error("Error in extractDirectLink with Puppeteer:", err);
    throw err; // Re-throw to be handled by the calling endpoint
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

app.post("/download", async (req, res) => {
  const { url: fileUrl, stream: streamFile } = req.body

  if (!fileUrl || !isValidMediafireURL(fileUrl)) {
    return res.status(400).json({ error: "Invalid or missing MediaFire URL." })
  }

  try {
    const directLink = await extractDirectLink(fileUrl);

    if (!directLink) {
      return res
        .status(404)
        .json({ error: "Direct download link not found on the MediaFire page. The page structure might have changed." })
    }

    if (streamFile) {
      const fileStreamResponse = await axios({
        url: directLink,
        method: "GET",
        responseType: "stream",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        },
      })

      const filename = decodeURIComponent(directLink.split("/").pop().split("?")[0])
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      fileStreamResponse.data.pipe(res)
    } else {
      res.json({
        success: true,
        filename: decodeURIComponent(directLink.split("/").pop().split("?")[0]),
        direct_link: directLink,
      })
    }
  } catch (err) {
    console.error("Error in /download endpoint:", err)

    if (axios.isAxiosError(err)) {
      if (err.response) {
        res.status(err.response.status).json({
          error: `Failed to retrieve file: Remote server responded with status ${err.response.status}.`,
          details: err.message,
        })
      } else if (err.request) {
        res.status(500).json({
          error: "Failed to retrieve file: No response received from MediaFire.",
          details: err.message,
        })
      } else {
        res.status(500).json({
          error: "Failed to retrieve file: Error setting up the request.",
          details: err.message,
        })
      }
    } else {
      res
        .status(500)
        .json({ error: "An unexpected error occurred while processing your request.", details: err.message })
    }
  }
})

app.get("/direct", async (req, res) => {
  const { url: fileUrl } = req.query;

  if (!fileUrl || !isValidMediafireURL(fileUrl)) {
    return res.status(400).send("Invalid or missing MediaFire URL.");
  }

  try {
    const directLink = await extractDirectLink(fileUrl);

    if (!directLink) {
      return res.status(404).send("Direct download link not found.");
    }

    res.redirect(directLink);
  } catch (err) {
    console.error("Error in /direct endpoint:", err);
    res.status(500).send("An error occurred while trying to get the direct link.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 MediaFire Downloader API running at http://localhost:${PORT}`)
})
