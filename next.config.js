/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // src/instrumentation.ts を有効化（起動時に削除走査スケジューラを立ち上げる）。
    instrumentationHook: true,
  },
  webpack: (config) => {
    // face-api.js はバンドル時に Node 専用の任意依存を参照する。ブラウザ向けには潰す。
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      encoding: false,
    };
    return config;
  },
};

module.exports = nextConfig;
