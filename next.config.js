const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: false,
  workboxOptions: {
    disableDevLogs: true
  }
});
const {
  createSecureHeaders
} = require("next-secure-headers");
const apiConfig = {
  DOMAIN_URL: "wudysoft.xyz"
};
const securityHeaders = [...createSecureHeaders({
  frameGuard: "deny",
  xssProtection: "block-rendering",
  referrerPolicy: "strict-origin-when-cross-origin"
}), {
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'; block-all-mixed-content; upgrade-insecure-requests;"
}, {
  key: "Permissions-Policy",
  value: "camera=(), microphone=(), geolocation=(), interest-cohort=()"
}, {
  key: "X-DNS-Prefetch-Control",
  value: "on"
}, {
  key: "Strict-Transport-Security",
  value: "max-age=31536000; includeSubDomains"
}, {
  key: "X-Content-Type-Options",
  value: "nosniff"
}, {
  key: "X-Frame-Options",
  value: "DENY"
}, {
  key: "X-XSS-Protection",
  value: "1; mode=block"
}, {
  key: "Referrer-Policy",
  value: "strict-origin-when-cross-origin"
}];
const nextConfig = withPWA({
  reactStrictMode: true,
  swcMinify: true,
  productionBrowserSourceMaps: false,
  compress: true,
  poweredByHeader: false,
  experimental: {
    appDir: true,
    nextScriptWorkers: true,
    serverActions: {
      bodySizeLimit: "5gb"
    },
    amp: {
      skipValidation: true
    }
  },
  images: {
    domains: [apiConfig.DOMAIN_URL, "cdn.weatherapi.com", "tile.openstreetmap.org", "www.chess.com", "deckofcardsapi.com", "raw.githubusercontent.com"],
    minimumCacheTTL: 60,
    remotePatterns: [{
      protocol: "https",
      hostname: "**"
    }]
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: securityHeaders
    }, {
      source: "/:path*(sw.js|workbox-*.js|manifest.json)",
      headers: [{
        key: "Cache-Control",
        value: "public, max-age=0, must-revalidate"
      }, {
        key: "Service-Worker-Allowed",
        value: "/"
      }]
    }, {
      source: "/api/:path*",
      headers: [{
        key: "Access-Control-Allow-Credentials",
        value: "true"
      }, {
        key: "Access-Control-Allow-Origin",
        value: "*"
      }, {
        key: "Access-Control-Allow-Methods",
        value: "GET, POST, PUT, DELETE, OPTIONS, PATCH"
      }, {
        key: "Access-Control-Allow-Headers",
        value: "Content-Type, Authorization, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version, Origin, X-CSRF-Token"
      }]
    }, {
      source: "/_next/static/(.*)",
      headers: [{
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable"
      }]
    }];
  },
  async rewrites() {
    return [{
      source: "/api/:path*",
      has: [{
        type: "header",
        key: "access-control-request-method"
      }],
      destination: "/api/:path*"
    }];
  },
  webpack: (config, {
    dev,
    isServer
  }) => {
    config.externals.push({
      "utf-8-validate": "commonjs utf-8-validate",
      bufferutil: "commonjs bufferutil"
    });
    if (!dev && !isServer) {
      const WebpackObfuscator = require("webpack-obfuscator");
      config.plugins.push(new WebpackObfuscator({
        compact: true,
        renameGlobals: false,
        identifierNamesGenerator: "hexadecimal",
        log: false,
        stringArray: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayThreshold: .75,
        unicodeEscapeSequence: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        disableConsoleOutput: true
      }));
    }
    return config;
  }
});
module.exports = nextConfig;