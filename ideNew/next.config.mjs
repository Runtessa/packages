const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: true,
  allowedDevOrigins: [
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://192.168.24.1:3002",
  ],
  experimental: {
    optimizeCss: false,
    serverSourceMaps: true
  }
};

export default nextConfig;
