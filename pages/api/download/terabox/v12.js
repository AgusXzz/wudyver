import axios from "axios";
import CryptoJS from "crypto-js";
class TeraboxDownloader {
  constructor() {
    this.key = "website:teraboxvideodownloader.pro";
  }
  async download({
    url
  }) {
    try {
      if (!url) {
        throw new Error("Link missing.");
      }
      const encrypted = CryptoJS.AES.encrypt(url, this.key).toString();
      const res = await axios.post("https://teraboxvideodownloader.pro/api/video-downloader", {
        link: encrypted
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });
      return res.data;
    } catch (error) {
      console.error("Error during download:", error.message);
      return null;
    }
  }
}
export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body;
  if (!params.url) {
    return res.status(400).json({
      error: "url is required"
    });
  }
  const downloader = new TeraboxDownloader();
  try {
    const data = await downloader.download(params);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Error during image processing"
    });
  }
}