import type { NextConfig } from 'next';

const config: NextConfig = {
  // packages/ui는 TS 소스를 그대로 내보낸다
  transpilePackages: ['@aircon/ui'],
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};
export default config;
