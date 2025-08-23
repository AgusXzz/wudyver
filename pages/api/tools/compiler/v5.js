import axios from "axios";
class NekoLabsTerminal {
  constructor() {
    this.apiUrl = "https://nekolabs.my.id/api/terminal";
    this.headers = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
      Referer: "https://nekolabs.my.id/terminal?try=website-screenshot"
    };
  }
  async run({
    code,
    lang: language = "javascript"
  }) {
    try {
      const {
        data
      } = await axios.post(this.apiUrl, {
        code: code,
        language: language
      }, {
        headers: this.headers
      });
      return data;
    } catch (error) {
      console.error("Execution failed:", error.message);
      throw error;
    }
  }
}
export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body;
  if (!params.code) {
    return res.status(400).json({
      error: `Missing required field: code (required for action)`
    });
  }
  const myCompiler = new NekoLabsTerminal();
  try {
    const data = await myCompiler.run(params);
    return res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error"
    });
  }
}