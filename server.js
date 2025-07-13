const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

function isValidMediafireURL(url) {
  return /^https?:\/\/(www\.)?mediafire\.com\/file\/.+/.test(url);
}

app.get("/download", async (req, res) => {
  const fileUrl = req.query.url;
  const streamFile = req.query.stream === "true";

  if (!fileUrl || !isValidMediafireURL(fileUrl)) {
    return res.status(400).json({ error: "Invalid or missing MediaFire URL." });
  }

  try {
    const response = await axios.get(fileUrl);
    const $ = cheerio.load(response.data);
    const downloadBtn = $("a#downloadButton");
    const directLink = downloadBtn.attr("href");

    if (!directLink) {
      return res.status(404).json({ error: "Direct link not found." });
    }

    if (streamFile) {
      const fileStream = await axios({
        url: directLink,
        method: "GET",
        responseType: "stream",
      });

      const filename = decodeURIComponent(
        directLink.split("/").pop().split("?")[0]
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      fileStream.data.pipe(res);
    } else {
      res.json({
        success: true,
        filename: decodeURIComponent(directLink.split("/").pop().split("?")[0]),
        direct_link: directLink,
      });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve file." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 MediaFire Downloader API running at http://localhost:${PORT}`);
});
