import { NextRequest, NextResponse } from 'next/server';
import { getPodcasts } from '@/lib/conductor';

export async function GET(_request: NextRequest) {
  try {
    const raw = await getPodcasts();

    const podcasts = raw.map(p => ({
      id: p.id,
      displayName: p.display_name,
      description: p.description || '',
      indexName: '',
      image: p.image || '',
      theme: {
        primary: p.theme?.primary || 'gray-500',
        secondary: p.theme?.secondary || 'gray-400',
        accent: p.theme?.accent || 'gray-600',
        gradientFrom: p.theme?.gradientFrom || 'gray-900',
        gradientTo: p.theme?.gradientTo || 'gray-800',
        background: 'gray-900',
        textPrimary: 'white',
        textSecondary: 'gray-300',
        border: 'gray-600',
      },
      socialSections: (p.social_sections || []).map(section => ({
        title: section.title,
        titleColor: section.titleColor,
        links: section.links.map(link => ({
          site: link.site,
          title: link.title,
          link: link.link,
          icon: null,
          hoverColor: link.hoverColor,
        })),
      })),
      sources: p.sources.map(s => ({
        site: s.site,
        name: s.name,
        url: '',
        type: s.type,
        enabled: true,
      })),
      enabled: true,
      order: p.display_order,
    }));

    return NextResponse.json(podcasts, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Podcasts API error:', error);
    return NextResponse.json({ error: 'Failed to load podcast configurations' }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.ALLOWED_ORIGINS?.split(',') || []].flat()
    : ['http://localhost:3000', 'http://localhost:3001'];

  const isAllowedOrigin = !origin || allowedOrigins.includes(origin);

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': isAllowedOrigin ? (origin || '*') : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}
