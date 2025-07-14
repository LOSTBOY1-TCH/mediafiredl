const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json()) // Add middleware to parse JSON request bodies

function isValidMediafireURL(url) {
  return /^https?:\/\/(www\.)?mediafire\.com\/file\/.+/.test(url)
}

// Helper function to extract the direct link
async function extractDirectLink(fileUrl) {
  try {
    const response = await axios.get(fileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
      },
    });
    const $ = cheerio.load(response.data);
    let directLink = $("a#downloadButton").attr("href");

    // If href is empty or javascript:void(0), try data-scrambled-url
    if (!directLink || directLink.startsWith("javascript:")) {
      const scrambledUrl = $("a#downloadButton").data("scrambled-url");
      if (scrambledUrl) {
        try {
          directLink = Buffer.from(scrambledUrl, 'base64').toString('utf8');
        } catch (decodeError) {
          console.warn("Failed to decode data-scrambled-url:", decodeError);
          directLink = null; // Reset directLink if decoding fails
        }
      }
    }

    // Fallback if primary and scrambled methods don't yield a valid direct link
    if (!directLink || directLink.startsWith("javascript:")) {
      const scriptContent = $("script").text();
      const match = scriptContent.match(/"downloadUrl":"(https?:\/\/[^"]+)"/);
      if (match && match[1]) {
        directLink = match[1].replace(/\\u002d/g, "-");
      }
    }

    if (!directLink || directLink.startsWith("javascript:")) {
      return null; // No direct link found after all attempts
    }

    if (!/^https?:\/\//.test(directLink)) {
      return null; // Not a valid URL format
    }

    return directLink;
  } catch (err) {
    console.error("Error in extractDirectLink:", err);
    throw err; // Re-throw to be handled by the calling endpoint
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
