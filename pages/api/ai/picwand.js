import axios from "axios";
import CryptoJS from "crypto-js";
import apiConfig from "@/configs/apiConfig";
import Encoder from "@/lib/encoder";
import SpoofHead from "@/lib/spoof-head";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class Picwand {
  constructor() {
    this.axios = axios.create({
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
        Origin: "https://www.picwand.ai",
        Referer: "https://www.picwand.ai/",
        ...SpoofHead()
      }
    });
    this.accessToken = null;
    this.tempMail = null;
    this.accountInfo = {};
    this.e_id = "545e3492a205b8cdb3f2eec5b5aa94be";
  }
  async enc(data) {
    const {
      uuid: jsonUuid
    } = await Encoder.enc({
      data: data,
      method: "combined"
    });
    return jsonUuid;
  }
  async dec(uuid) {
    const decryptedJson = await Encoder.dec({
      uuid: uuid,
      method: "combined"
    });
    return decryptedJson.text;
  }
  _generateSignature(jsonObject) {
    try {
      const sortedKeys = Object.keys(jsonObject).sort().reverse();
      const paramString = sortedKeys.filter(key => jsonObject[key] !== undefined && jsonObject[key] !== null).map(key => Array.isArray(jsonObject[key]) ? `${key}=${JSON.stringify(jsonObject[key])}` : `${key}=${jsonObject[key]}`).join("&") + this.e_id;
      return CryptoJS.SHA256(paramString).toString(CryptoJS.enc.Hex);
    } catch (error) {
      console.error("Gagal menghasilkan signature:", error);
      throw error;
    }
  }
  async _authenticate() {
    try {
      console.log("Memulai proses otentikasi...");
      console.log("\n[1/5] Membuat email sementara...");
      const mailResponse = await this.axios.get(`https://${apiConfig.DOMAIN_URL}/api/mails/v9?action=create`);
      this.tempMail = mailResponse?.data?.email;
      if (!this.tempMail) throw new Error("Gagal membuat email sementara.");
      console.log(` > Email dibuat: ${this.tempMail}`);
      console.log("\n[2/5] Meminta kode OTP...");
      await this.axios.post("https://account.api.picwand.ai/v13/account/authcode/email/passless", new URLSearchParams({
        e_id: this.e_id,
        email: this.tempMail,
        language: "en",
        invite_code: ""
      }).toString());
      console.log(" > Permintaan OTP berhasil dikirim.");
      console.log("\n[3/5] Mengambil OTP...");
      let otp = null;
      for (let i = 0; i < 60; i++) {
        await sleep(3e3);
        const messagesResponse = await this.axios.get(`https://${apiConfig.DOMAIN_URL}/api/mails/v9?action=message&email=${this.tempMail}`);
        const extractedOtp = messagesResponse?.data?.data?.[0]?.text_content?.match(/Your verification code is:(\d{6})/)?.[1];
        if (extractedOtp) {
          otp = extractedOtp;
          console.log(` > OTP ditemukan: ${otp}`);
          break;
        }
        console.log(" > OTP belum ditemukan, mencoba lagi...");
      }
      if (!otp) throw new Error("Tidak dapat mengambil OTP.");
      console.log("\n[4/5] Login dengan OTP...");
      const loginResponse = await this.axios.post("https://account.api.picwand.ai/v13/account/email/passless", new URLSearchParams({
        e_id: this.e_id,
        email: this.tempMail,
        authcode: otp,
        invite_code: ""
      }).toString());
      if (loginResponse?.data?.error !== 0) throw new Error(`Login gagal: ${JSON.stringify(loginResponse.data)}`);
      this.accountInfo = {
        token: loginResponse.data.token,
        t_id: loginResponse.data.t_id
      };
      console.log(" > Login berhasil.");
      console.log("\n[5/5] Mendapatkan token akses akhir (JWT)...");
      const timestamps = Math.floor(Date.now() / 1e3);
      const tokenApiPayload = {
        e_id: this.e_id,
        t_id: this.accountInfo.t_id,
        token: this.accountInfo.token,
        timestamps: timestamps
      };
      const signature = this._generateSignature(tokenApiPayload);
      const finalTokenResponse = await this.axios.post("https://itfv.picwand.ai/v6/api/token", {
        ...tokenApiPayload,
        sign: signature
      });
      this.accessToken = finalTokenResponse?.data?.data?.token;
      if (finalTokenResponse?.data?.code !== 0 || !this.accessToken) {
        throw new Error(`Gagal mendapatkan token akhir: ${finalTokenResponse?.data?.msg || "Token tidak ditemukan"}`);
      }
      console.log(" > Otentikasi selesai. Token akses diterima.");
    } catch (error) {
      console.error("Proses otentikasi gagal:", error.message);
      if (error.response) console.error("Data Respons Gagal:", error.response.data);
      throw error;
    }
  }
  async txt2vid({
    prompt,
    ...rest
  }) {
    try {
      if (!this.accessToken) await this._authenticate();
      console.log("\n[1/2] Membuat tugas video dari teks...");
      const timestamps = Math.floor(Date.now() / 1e3);
      const payload = {
        e_id: this.e_id,
        model_tab: 1,
        module_type: 10,
        language: "en",
        width: 0,
        height: 0,
        prompt: prompt,
        duration: 5,
        fps: 24,
        resolution: "720p",
        ratio: "3:4",
        model_type: 15,
        seed: Math.floor(Math.random() * 2e9),
        public_visbility: 1,
        copy_protection: 0,
        model_id: 15,
        pattern: 0,
        mode: "std",
        negative_prompt: "",
        cfg_scale: 50,
        n_t_b: 0,
        p_t_b: 0,
        bgm: -1,
        motion_type: "",
        model_style: "",
        camera_movement: "",
        timestamps: timestamps,
        ...rest
      };
      payload.sign = this._generateSignature(payload);
      const createTaskResponse = await this.axios.post("https://itfv.picwand.ai/v6/api/ctitv", payload, {
        headers: {
          "access-token": this.accessToken
        }
      });
      console.log(" > Respon Data:", createTaskResponse.data);
      const taskId = createTaskResponse?.data?.data?.taskid;
      if (!taskId) {
        throw new Error(`Gagal membuat tugas: ${createTaskResponse?.data?.msg || "Tidak ada taskid yang diterima."}`);
      }
      console.log("\n[2/2] Tugas berhasil dibuat atau diantrekan!");
      console.log(` > Task ID: ${taskId}`);
      const encryptedData = {
        taskId: taskId,
        accessToken: this.accessToken
      };
      console.log(`[LOG] Txt2vid: Tugas video berhasil dibuat. ID terenkripsi: ${await this.enc(encryptedData)}`);
      return await this.enc(encryptedData);
    } catch (error) {
      console.error("Fungsi txt2vid gagal:", error.message);
      if (error.response) console.error("Data Respons Gagal:", error.response.data);
      throw error;
    }
  }
  async img2vid({
    prompt,
    imageUrl,
    ...rest
  }) {
    try {
      if (!this.accessToken) await this._authenticate();
      console.log("\n[1/4] Mendapatkan URL pre-signed...");
      const signResponse = await this.axios.post("https://itfv.picwand.ai/v5/api/editor/resource/sign/v4", {
        module_type: 9,
        module: {
          mime_type: "image/png",
          extension: "png"
        }
      });
      if (signResponse?.data?.code !== 200) throw new Error(`Gagal mendapatkan URL pre-signed: ${signResponse?.data?.msg}`);
      const uploadInfo = JSON.parse(Buffer.from(signResponse.data.data, "base64").toString("utf-8"))[0];
      console.log(`\n[2/4] Mengunggah gambar dari ${imageUrl}...`);
      const imageResponse = await this.axios.get(imageUrl, {
        responseType: "arraybuffer"
      });
      const imageBuffer = Buffer.from(imageResponse.data, "binary");
      await this.axios.put(uploadInfo.module, imageBuffer, {
        headers: {
          "Content-Type": "image/png"
        }
      });
      console.log(" > Gambar berhasil diunggah.");
      console.log("\n[3/4] Membuat tugas video...");
      const timestamps = Math.floor(Date.now() / 1e3);
      const ctitvPayload = {
        name: imageUrl.split("/").pop(),
        s3key: uploadInfo.key,
        file_size: imageBuffer.length,
        width: 1024,
        height: 1792,
        file_type: "WEBP",
        imgFile: {},
        e_id: this.e_id,
        model_tab: 2,
        module_type: 9,
        language: "en",
        prompt: prompt,
        duration: 5,
        fps: 24,
        resolution: "720p",
        ratio: "adaptive",
        last_image: "",
        model_type: 1,
        seed: Math.floor(Math.random() * 2e9),
        public_visbility: 1,
        copy_protection: 0,
        model_id: 1,
        pattern: 0,
        mode: "std",
        negative_prompt: "",
        cfg_scale: 50,
        n_t_b: 0,
        p_t_b: 0,
        bgm: -1,
        motion_type: "",
        model_style: "",
        camera_movement: "",
        timestamps: timestamps,
        ...rest
      };
      ctitvPayload.sign = this._generateSignature(ctitvPayload);
      const createTaskResponse = await this.axios.post("https://itfv.picwand.ai/v6/api/ctitv", ctitvPayload, {
        headers: {
          "access-token": this.accessToken
        }
      });
      console.log(" > Respon Data:", createTaskResponse.data);
      const taskId = createTaskResponse?.data?.data?.taskid;
      if (!taskId) {
        throw new Error(`Gagal membuat tugas: ${createTaskResponse?.data?.msg || "Tidak ada taskid yang diterima."}`);
      }
      console.log("\n[4/4] Tugas berhasil dibuat atau diantrekan!");
      console.log(` > Task ID: ${taskId}`);
      const encryptedData = {
        taskId: taskId,
        accessToken: this.accessToken
      };
      console.log(`[LOG] Txt2vid: Tugas video berhasil dibuat. ID terenkripsi: ${await this.enc(encryptedData)}`);
      return await this.enc(encryptedData);
    } catch (error) {
      console.error("Fungsi img2vid gagal:", error.message);
      if (error.response) console.error("Data Respons Gagal:", error.response.data);
      throw error;
    }
  }
  async status({
    task_id,
    ...rest
  }) {
    console.log(`[LOG] Status: Memeriksa status untuk ID tugas terenkripsi: ${task_id}.`);
    try {
      const decryptedData = await this.dec(task_id);
      const {
        taskId,
        accessToken
      } = decryptedData;
      if (!accessToken) throw new Error("Belum terotentikasi. Jalankan img2vid atau txt2vid terlebih dahulu.");
      if (!taskId) throw new Error("taskId diperlukan untuk memeriksa status.");
      console.log(`\nMemeriksa status untuk taskId: ${taskId}...`);
      const timestamps = Math.floor(Date.now() / 1e3);
      const statusPayload = {
        taskid: taskId,
        e_id: this.e_id,
        timestamps: timestamps,
        ...rest
      };
      statusPayload.sign = this._generateSignature(statusPayload);
      const statusResponse = await this.axios.post("https://itfv.picwand.ai/v6/api/gritv", statusPayload, {
        headers: {
          "access-token": accessToken
        }
      });
      console.log(" > Respon Data:", statusResponse.data);
      if (statusResponse?.data?.code !== 200) {
        console.warn(`Peringatan: Status code adalah ${statusResponse?.data?.code}. Pesan: ${statusResponse?.data?.msg}`);
      }
      console.log(" > Status diterima:", statusResponse?.data?.data);
      return statusResponse?.data?.data;
    } catch (error) {
      console.error("Pemeriksaan status gagal:", error.message);
      if (error.response) console.error("Data Respons Gagal:", error.response.data);
      throw error;
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
  const picwand = new Picwand();
  try {
    let response;
    switch (action) {
      case "img2vid":
        if (!params.prompt || !params.imageUrl) {
          return res.status(400).json({
            error: "Prompt and imageUrl are required for img2vid."
          });
        }
        const img2vid_task_id = await picwand.img2vid(params);
        return res.status(200).json({
          task_id: img2vid_task_id
        });
      case "txt2vid":
        if (!params.prompt) {
          return res.status(400).json({
            error: "Prompt is required for txt2vid."
          });
        }
        const txt2vid_task_id = await picwand.txt2vid(params);
        return res.status(200).json({
          task_id: txt2vid_task_id
        });
      case "status":
        if (!params.task_id) {
          return res.status(400).json({
            error: "task_id is required for status."
          });
        }
        response = await picwand.status(params);
        return res.status(200).json(response);
      default:
        return res.status(400).json({
          error: `Invalid action: ${action}. Supported actions are 'img2vid', 'txt2vid', and 'status'.`
        });
    }
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({
      error: error.message || "Internal Server Error"
    });
  }
}