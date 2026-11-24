import type { NextConfig } from 'next';

const config: NextConfig = {
  // packages/ui는 TS 소스를 그대로 내보낸다
  transpilePackages: ['@aircon/ui'],
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
  // 단계 5-1 작업 사진·서명 업로드(서버 액션). 사진은 브라우저에서 줄여 보내고, Vercel 요청 한도(4.5MB) 안으로 둔다
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
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
