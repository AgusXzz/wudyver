import axios from "axios";
import * as cheerio from "cheerio";
import FormData from "form-data";
import {
  CookieJar
} from "tough-cookie";
import {
  wrapper
} from "axios-cookiejar-support";
import apiConfig from "@/configs/apiConfig";
const servicesInfo = {
  array: ["qobuz", "tidal", "soundcloud", "deezer", "amazon", "yandex"],
  string: "Qobuz, Tidal, Soundcloud, Deezer, Amazon Music, and Yandex Music"
};

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
class Lucida {
  constructor() {
    this.axiosInstance = axios.create({
      baseURL: "https://lucida.to",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "id-ID",
        "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99", "Microsoft Edge Simulate";v="127", "Lemur";v="127"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"
      }
    });
    this.services = servicesInfo;
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({
      jar: this.jar,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400
    }));
  }
  #generateToken() {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let primary = "";
    for (let i = 0; i < 25; i++) {
      primary += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const expiry = Math.floor(Date.now() / 1e3) + 2 * 365 * 24 * 60 * 60;
    console.log("Token baru telah dibuat.");
    return {
      primary: primary,
      expiry: expiry
    };
  }
  async search({
    query = "",
    service = "qobuz",
    country = "US"
  } = {}) {
    if (!query) throw new Error("Query pencarian tidak boleh kosong.");
    try {
      console.log(`Mencari "${query}" di ${service} (${country})...`);
      const response = await this.axiosInstance.get("/search", {
        params: {
          query: query,
          service: service,
          country: country
        },
        headers: {
          accept: "text/html"
        }
      });
      const $ = cheerio.load(response.data);
      const results = [];
      $(".search-result-track").each((_, element) => {
        const title = $(element).find(".metadata h1").text()?.trim() || "Judul tidak diketahui";
        const artist = $(element).find(".metadata h2").text()?.trim() || "Artis tidak diketahui";
        const albumInfo = $(element).find(".metadata h3").text()?.trim().match(/(.+) \((\d{4})\)/) || [];
        const url = $(element).find(".metadata a").attr("href") || "";
        const ids = btoa(url) || "";
        results.push({
          title: title,
          artist: artist,
          ids: ids,
          album: albumInfo[1]?.trim() || "Album tidak diketahui",
          year: albumInfo[2] || "Tahun tidak diketahui",
          url: url ? new URL(url, "https://lucida.to").href : ""
        });
      });
      console.log(`Ditemukan ${results.length} hasil.`);
      return results;
    } catch (error) {
      console.error("Terjadi kesalahan saat mencari:", error.message);
      return [];
    }
  }
  async #polling(pollUrl) {
    console.log("Memulai polling untuk status unduhan...");
    while (true) {
      const response = await axios.get(pollUrl, {
        headers: {
          origin: "https://lucida.to",
          referer: "https://lucida.to/"
        }
      });
      const {
        status,
        message
      } = response.data;
      console.log(`Status polling saat ini: ${status}`);
      if (status === "completed") return;
      if (status === "failed") throw new Error(message || "Proses unduhan gagal saat polling.");
      await new Promise(resolve => setTimeout(resolve, 2e3));
    }
  }
  async download({
    ids = "",
    host = "Instantiated"
  }) {
    const trackUrl = ids.startsWith("https") ? ids : atob(ids);
    if (!trackUrl) throw new Error("URL trek tidak boleh kosong.");
    try {
      console.log(`\nMemulai proses unduhan untuk: ${trackUrl}`);
      const originalUrl = new URL(trackUrl).searchParams.get("url");
      const postData = {
        url: originalUrl,
        metadata: true,
        compat: false,
        private: false,
        handoff: true,
        account: {
          type: "country",
          id: "auto"
        },
        upload: {
          enabled: false,
          service: "pixeldrain"
        },
        downscale: "original",
        token: this.#generateToken()
      };
      const initialResponse = await this.axiosInstance.post("/api/load?url=%2Fapi%2Ffetch%2Fstream%2Fv2", JSON.stringify(postData), {
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          origin: "https://lucida.to",
          referer: trackUrl
        }
      });
      const {
        handoff,
        server
      } = initialResponse.data;
      if (!handoff || !server) {
        console.error("Respons API tidak valid:", JSON.stringify(initialResponse.data, null, 2));
        throw new Error("Gagal mendapatkan handoff ID atau server.");
      }
      console.log(`Handoff ID: ${handoff}, Server: ${server}`);
      await this.#polling(`https://${server}.lucida.to/api/fetch/request/${handoff}`);
      const downloadApiUrl = `https://lucida.to/api/load?url=%2Fapi%2Ffetch%2Frequest%2F${handoff}%2Fdownload&force=${server}&redirect=true`;
      const response = await this.client.get(downloadApiUrl, {
        headers: {
          referer: "https://lucida.to/"
        }
      });
      if (response.headers.location) return await this.fetchAndUploadMedia(response.headers.location, postData.token.primary, host);
      throw new Error("Tidak dapat menemukan URL redirect di header respons.");
    } catch (error) {
      console.error("Terjadi kesalahan saat proses unduhan:", error.message);
      return null;
    }
  }
  async fetchAndUploadMedia(initialDownloadLink, query, host) {
    if (!initialDownloadLink) throw new Error("Link unduhan awal tidak boleh kosong.");
    try {
      console.log(`\nMengunduh stream media dan mempersiapkan unggahan...`);
      const mediaResponse = await axios.get(initialDownloadLink, {
        responseType: "stream",
        maxRedirects: 10
      });
      const fileStream = mediaResponse.data;
      const finalHeaders = mediaResponse.headers;
      const contentType = finalHeaders["content-type"];
      const contentLength = finalHeaders["content-length"];
      if (!contentType || !contentType.startsWith("audio/")) throw new Error(`Tipe konten tidak valid (${contentType}). Proses unggah dibatalkan.`);
      console.log(`Stream media diterima. Ukuran: ${formatBytes(contentLength)}. Tipe: ${contentType}.`);
      const form = new FormData();
      const sanitizedQuery = query.replace(/\s+/g, "_").replace(/[^\w-]/g, "");
      const fileExtension = contentType.split("/")[1] || "flac";
      const fileName = `${sanitizedQuery}.${fileExtension}`;
      form.append("file", fileStream, {
        filename: fileName,
        contentType: contentType,
        knownLength: contentLength
      });
      const uploadUrl = `https://${apiConfig.DOMAIN_URL}/api/tools/upload?host=${host}`;
      console.log(`Mengunggah file "${fileName}" ke: ${uploadUrl}`);
      const uploadResponse = await axios.post(uploadUrl, form, {
        headers: {
          ...form.getHeaders()
        }
      });
      console.log("✅ File berhasil diunggah!");
      return uploadResponse.data;
    } catch (error) {
      console.error("Terjadi kesalahan saat mengunduh/mengunggah media:", error.message);
      if (error.response) console.error("Detail Respons Error:", error.response.data);
      return null;
    }
  }
}
export default async function handler(req, res) {
  const {
    action,
    ...params
  } = req.method === "GET" ? req.query : req.body;
  if (!action) {
    return res.status(400).json({
      error: "Action is required."
    });
  }
  const client = new Lucida();
  try {
    let response;
    switch (action) {
      case "search":
        if (!params.query) {
          return res.status(400).json({
            error: "query is required for search."
          });
        }
        response = await client.search(params);
        return res.status(200).json(response);
      case "download":
        if (!params.ids) {
          return res.status(400).json({
            error: "ids is required for download."
          });
        }
        response = await client.download(params);
        return res.status(200).json(response);
      default:
        return res.status(400).json({
          error: `Invalid action: ${action}. Supported actions are 'search', and 'download'.`
        });
    }
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({
      error: error.message || "Internal Server Error"
    });
  }
}