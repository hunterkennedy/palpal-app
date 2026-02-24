import { NextResponse } from 'next/server';
import { searchClient } from '@/lib/meilisearch';

export async function GET() {
  try {
    // Check Meilisearch health
    const meilisearchHealth = await searchClient.health();
    const isHealthy = meilisearchHealth.status === 'available';

    if (!isHealthy) {
      return NextResponse.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          meilisearch: 'unavailable'
        },
        version: process.env.npm_package_version || '1.0.0'
      }, { status: 503 });
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        meilisearch: 'available'
      },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    });

  } catch (error) {
    console.error('Health check failed:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Service check failed',
      version: process.env.npm_package_version || '1.0.0'
    }, { status: 503 });
  }
}