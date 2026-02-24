/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  compress: true,
  poweredByHeader: false,
  
  experimental: {
    optimizeCss: true,
  },

  async headers() {
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value: `
          default-src 'self';
          script-src 'self' 'unsafe-inline' 'unsafe-eval' https://storage.ko-fi.com;
          style-src 'self' 'unsafe-inline' fonts.googleapis.com;
          img-src 'self' data: https: blob:;
          font-src 'self' data: fonts.gstatic.com;
          connect-src 'self' ${process.env.NEXT_PUBLIC_MEILISEARCH_HOST || 'http://localhost:7700'} https://www.youtube.com https://patreon.com https://www.twitch.tv https://ko-fi.com https://storage.ko-fi.com;
          frame-src https://www.youtube.com https://ko-fi.com;
          object-src 'none';
          base-uri 'self';
          form-action 'self';
          upgrade-insecure-requests;
        `.replace(/\s+/g, ' ').trim()
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff'
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY'
      },
      {
        key: 'X-XSS-Protection',
        value: '1; mode=block'
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin'
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains'
      }
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/(.*)',
        headers: [
          ...securityHeaders,
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=300, stale-while-revalidate=86400'
          }
        ],
      },
    ];
  },

  async rewrites() {
    return [
      {
        source: '/health',
        destination: '/api/health'
      }
    ];
  },

  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      // Bundle optimization
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            priority: -10,
            chunks: 'all'
          }
        }
      };
    }

    return config;
  },

  env: {
    CUSTOM_KEY: 'palpal-search-engine',
  },

  // Performance optimizations
  
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },
};

module.exports = nextConfig;