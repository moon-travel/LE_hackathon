/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Enable src/instrumentation.ts (starts the retention scanner at startup).
    instrumentationHook: true,
  },
  webpack: (config) => {
    // face-api.js references optional Node-only deps when bundled; stub them out for the browser.
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
