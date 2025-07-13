const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())

function isValidMediafireURL(url) {
  return /^https?:\/\/(www\.)?mediafire\.com\/file\/.+/.test(url)
}

app.get("/download", async (req, res) => {
  const fileUrl = req.query.url
  const streamFile = req.query.stream === "true"

  if (!fileUrl || !isValidMediafireURL(fileUrl)) {
    return res.status(400).json({ error: "Invalid or missing MediaFire URL." })
  }

  try {
    const response = await axios.get(fileUrl)
    const $ = cheerio.load(response.data)
    let directLink = $("a#downloadButton").attr("href")

    // Fallback if the primary selector doesn't yield a direct link
    // Sometimes the link might be embedded in a script tag
    if (!directLink) {
      const scriptContent = $("script").text()
      const match = scriptContent.match(/"downloadUrl":"(https?:\/\/[^"]+)"/)
      if (match && match[1]) {
        directLink = match[1].replace(/\\u002d/g, "-") // Handle escaped characters if any
      }
    }

    if (!directLink) {
      return res
        .status(404)
        .json({ error: "Direct download link not found on the MediaFire page. The page structure might have changed." })
    }

    // Basic validation for the extracted direct link
    if (!/^https?:\/\//.test(directLink)) {
      return res.status(500).json({ error: "Extracted direct link is not a valid URL format." })
    }

    if (streamFile) {
      const fileStreamResponse = await axios({
        url: directLink,
        method: "GET",
        responseType: "stream",
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
    console.error("Error in /download endpoint:", err) // Log the full error object for debugging

    if (axios.isAxiosError(err)) {
      if (err.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        res.status(err.response.status).json({
          error: `Failed to retrieve file: Remote server responded with status ${err.response.status}.`,
          details: err.message,
        })
      } else if (err.request) {
        // The request was made but no response was received
        res.status(500).json({
          error: "Failed to retrieve file: No response received from MediaFire.",
          details: err.message,
        })
      } else {
        // Something happened in setting up the request that triggered an Error
        res.status(500).json({
          error: "Failed to retrieve file: Error setting up the request.",
          details: err.message,
        })
      }
    } else {
      // Generic unexpected error
      res
        .status(500)
        .json({ error: "An unexpected error occurred while processing your request.", details: err.message })
    }
  }
})

app.listen(PORT, () => {
  console.log(`🚀 MediaFire Downloader API running at http://localhost:${PORT}`)
})
