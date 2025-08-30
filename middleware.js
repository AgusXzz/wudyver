import {
  NextResponse,
  NextRequest
} from "next/server";
import {
  getToken
} from "next-auth/jwt";
import apiConfig from "@/configs/apiConfig";
import axios from "axios";
import {
  RateLimiterMemory
} from "rate-limiter-flexible";
import NextCors from "nextjs-cors";
import requestIp from "request-ip";

function getClientIp(req) {
  try {
    const headers = {};
    req.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const requestLike = {
      headers: headers,
      connection: {
        remoteAddress: req.ip || headers["x-forwarded-for"] || headers["x-real-ip"]
      },
      socket: {
        remoteAddress: req.ip || headers["x-forwarded-for"] || headers["x-real-ip"]
      },
      info: {
        remoteAddress: req.ip || headers["x-forwarded-for"] || headers["x-real-ip"]
      }
    };
    const clientIp = requestIp.getClientIp(requestLike);
    if (clientIp && clientIp !== "::1" && clientIp !== "127.0.0.1") {
      return clientIp;
    }
    const fallbackIp = req.ip || headers["cf-connecting-ip"] || headers["x-real-ip"] || headers["x-forwarded-for"]?.split(",")[0]?.trim() || headers["x-client-ip"] || headers["x-forwarded"] || headers["forwarded-for"] || headers["forwarded"] || "unknown";
    console.log(`[IP-Detection] request-ip result: ${clientIp}, fallback: ${fallbackIp}`);
    return fallbackIp;
  } catch (error) {
    console.error("[IP-Detection] Error in getClientIp:", error);
    return req.ip || req.headers.get("x-forwarded-for") || "unknown";
  }
}
const DOMAIN_URL = apiConfig.DOMAIN_URL || "wudysoft.xyz";
const NEXTAUTH_SECRET = apiConfig.JWT_SECRET;
const DEFAULT_PROTOCOL = "https://";
const axiosInstance = axios.create({
  timeout: 1e4,
  headers: {
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "User-Agent": "NextJS-Middleware/1.0"
  }
});
const rateLimiter = new RateLimiterMemory({
  points: apiConfig.LIMIT_POINTS,
  duration: apiConfig.LIMIT_DURATION
});
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*).*)"]
};

function ensureProtocol(url, defaultProtocol) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return defaultProtocol + url;
  }
  return url;
}

function addSecurityHeaders(response) {
  const cspHeader = `
    frame-ancestors 'none';
    block-all-mixed-content;
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, " ").trim();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
}

function addCorsHeaders(response) {
  const corsOptions = {
    origin: ["*"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Accept-Version", "Content-Length", "Content-MD5", "Date", "X-Api-Version", "Origin", "X-CSRF-Token"],
    credentials: true,
    maxAge: 86400
  };
  response.headers.set("Access-Control-Allow-Origin", corsOptions.origin.join(", "));
  response.headers.set("Access-Control-Allow-Methods", corsOptions.methods.join(", "));
  response.headers.set("Access-Control-Allow-Headers", corsOptions.allowedHeaders.join(", "));
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Max-Age", corsOptions.maxAge.toString());
  return response;
}

function addRateLimitHeaders(response, rateLimiterRes = null, totalLimit = null) {
  if (rateLimiterRes) {
    response.headers.set("X-RateLimit-Limit", totalLimit || apiConfig.LIMIT_POINTS);
    response.headers.set("X-RateLimit-Remaining", rateLimiterRes.remainingPoints);
    response.headers.set("X-RateLimit-Reset", Math.ceil((Date.now() + rateLimiterRes.msBeforeNext) / 1e3));
  } else {
    response.headers.set("X-RateLimit-Limit", totalLimit || apiConfig.LIMIT_POINTS);
    response.headers.set("X-RateLimit-Remaining", apiConfig.LIMIT_POINTS);
    response.headers.set("X-RateLimit-Reset", Math.ceil(Date.now() / 1e3) + apiConfig.LIMIT_DURATION);
  }
  return response;
}
async function performTracking(req) {
  try {
    const currentUrl = new URL(req.url);
    const currentPathname = currentUrl.pathname;
    const baseURL = ensureProtocol(DOMAIN_URL, DEFAULT_PROTOCOL);
    const isApiRoute = currentPathname.startsWith("/api");
    const isVisitorApi = currentPathname.includes("/api/visitor");
    const isAuthApi = currentPathname.includes("/api/auth");
    const isGeneralApi = currentPathname.includes("/api/general");
    const isAuthPage = currentPathname === "/login" || currentPathname === "/register";
    if (isApiRoute && !isVisitorApi && !isAuthApi && !isGeneralApi) {
      console.log(`[Middleware-Tracking] Mengirim data permintaan API untuk tracking: ${currentPathname}`);
      await axiosInstance.get(`${baseURL}/api/visitor/req`);
    } else if (!isApiRoute && !isAuthPage) {
      console.log(`[Middleware-Tracking] Mengirim data kunjungan halaman untuk tracking: ${currentPathname}`);
      await axiosInstance.get(`${baseURL}/api/visitor/visit`);
      await axiosInstance.post(`${baseURL}/api/visitor/info`, {
        route: currentPathname,
        time: new Date().toISOString(),
        hit: 1
      });
    }
  } catch (err) {
    const errorMessage = err.response ? `Status ${err.response.status}: ${err.response.data?.message || err.message}` : err.message;
    console.error(`[Middleware-Tracking] Gagal mencatat pengunjung untuk ${req.url}: ${errorMessage}`);
  }
}
export async function middleware(req) {
  const url = new URL(req.url);
  const {
    pathname
  } = url;
  const ipAddress = getClientIp(req);
  console.log(`[Middleware-Main] Menerima permintaan untuk: ${pathname} dari IP: ${ipAddress}`);
  console.log(`[Middleware-IP] Headers untuk deteksi IP: x-forwarded-for=${req.headers.get("x-forwarded-for")}, x-real-ip=${req.headers.get("x-real-ip")}, cf-connecting-ip=${req.headers.get("cf-connecting-ip")}`);
  console.log("[Middleware-Main] NEXTAUTH_SECRET (first 5 chars):", NEXTAUTH_SECRET ? NEXTAUTH_SECRET.substring(0, 5) + "..." : "Not set");
  let response = NextResponse.next();
  try {
    const isApiRoute = pathname.startsWith("/api");
    const isLoginRoute = pathname === "/login";
    const isRegisterRoute = pathname === "/register";
    const isAuthPage = isLoginRoute || isRegisterRoute;
    const isAnalyticsRoute = pathname === "/analytics";
    const isRootRoute = pathname === "/";
    const isVisitorApi = pathname.includes("/api/visitor");
    const isAuthApi = pathname.includes("/api/auth");
    const isGeneralApi = pathname.includes("/api/general");
    const nextAuthToken = await getToken({
      req: req,
      secret: NEXTAUTH_SECRET
    });
    console.log("[Middleware-Main] nextAuthToken:", nextAuthToken);
    const isAuthenticated = !!nextAuthToken;
    console.log(`[Middleware-Main] Pathname: ${pathname}, Autentikasi: ${isAuthenticated ? "Ya" : "Tidak"}`);
    if (req.method === "OPTIONS") {
      console.log(`[Middleware-CORS] Handling OPTIONS preflight request for: ${pathname}`);
      response = new NextResponse(null, {
        status: 200
      });
      response = addCorsHeaders(response);
      response = addSecurityHeaders(response);
      return response;
    }
    let rateLimiterRes = null;
    if (isApiRoute && !isVisitorApi && !isAuthApi && !isGeneralApi) {
      console.log(`[Middleware-RateLimit] Menerapkan Rate Limiting untuk API: ${pathname}`);
      try {
        rateLimiterRes = await rateLimiter.consume(ipAddress, 1);
        console.log(`[Middleware-RateLimit] Rate limit berhasil. Sisa permintaan: ${rateLimiterRes.remainingPoints}`);
      } catch (rateLimiterError) {
        const retryAfterSeconds = Math.ceil(rateLimiterError.msBeforeNext / 1e3);
        const totalLimit = apiConfig.LIMIT_POINTS;
        console.warn(`[Middleware-RateLimit] Rate limit terlampaui untuk IP: ${ipAddress}. Coba lagi dalam ${retryAfterSeconds} detik.`);
        response = new NextResponse(JSON.stringify({
          status: "error",
          code: 429,
          message: `Terlalu banyak permintaan. Anda telah melampaui batas ${totalLimit} permintaan per ${apiConfig.LIMIT_DURATION} detik. Silakan coba lagi dalam ${retryAfterSeconds} detik.`,
          limit: totalLimit,
          remaining: 0,
          retryAfter: retryAfterSeconds
        }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": retryAfterSeconds.toString()
          }
        });
        response = addSecurityHeaders(response);
        response = addCorsHeaders(response);
        response = addRateLimitHeaders(response, null, totalLimit);
        response.headers.set("X-RateLimit-Remaining", "0");
        response.headers.set("X-RateLimit-Reset", Math.ceil((Date.now() + rateLimiterError.msBeforeNext) / 1e3).toString());
        await performTracking(req);
        return response;
      }
    }
    response = addSecurityHeaders(response);
    if (isApiRoute) {
      response = addCorsHeaders(response);
    }
    if (isApiRoute && !isVisitorApi && !isAuthApi && !isGeneralApi) {
      response = addRateLimitHeaders(response, rateLimiterRes);
    }
    const redirectUrlWithProtocol = ensureProtocol(DOMAIN_URL, DEFAULT_PROTOCOL);
    if (isApiRoute) {
      console.log(`[Middleware-Auth] API route ${pathname} diakses, melanjutkan tanpa pengecekan autentikasi.`);
      await performTracking(req);
      return response;
    }
    if (isAuthenticated) {
      if (isAuthPage) {
        console.log(`[Middleware-Auth] Pengguna terautentikasi mencoba mengakses halaman otentikasi (${pathname}). Mengarahkan ke /analytics.`);
        await performTracking(req);
        response = NextResponse.redirect(`${redirectUrlWithProtocol}/analytics`);
        response = addSecurityHeaders(response);
        return response;
      } else if (isRootRoute) {
        console.log(`[Middleware-Auth] Pengguna terautentikasi mengakses halaman home (/). Mengarahkan ke /analytics.`);
        await performTracking(req);
        response = NextResponse.redirect(`${redirectUrlWithProtocol}/analytics`);
        response = addSecurityHeaders(response);
        return response;
      }
      console.log(`[Middleware-Auth] Pengguna terautentikasi melanjutkan ke ${pathname}.`);
      await performTracking(req);
      return response;
    } else {
      const isPublicPath = isAuthPage;
      if (!isPublicPath) {
        console.log(`[Middleware-Auth] Pengguna belum terautentikasi mencoba mengakses ${pathname}. Mengarahkan ke /login.`);
        await performTracking(req);
        response = NextResponse.redirect(`${redirectUrlWithProtocol}/login`);
        response = addSecurityHeaders(response);
        return response;
      }
      console.log(`[Middleware-Auth] Pengguna belum terautentikasi melanjutkan ke ${pathname}.`);
      await performTracking(req);
      return response;
    }
  } catch (error) {
    console.error("[Middleware-Error] Kesalahan tidak tertangani:", error);
    response = new NextResponse(JSON.stringify({
      status: "error",
      code: 500,
      message: "Kesalahan Server Internal"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
    response = addSecurityHeaders(response);
    if (pathname.startsWith("/api")) {
      response = addCorsHeaders(response);
    }
    return response;
  }
}