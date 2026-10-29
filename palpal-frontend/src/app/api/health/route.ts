import { NextResponse } from 'next/server';
import { checkHealth } from '@/lib/conductor';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const health = await checkHealth();
    const isHealthy = health.status === 'ok';

    if (!isHealthy) {
      return NextResponse.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: { conductor: 'unavailable' },
        version: process.env.npm_package_version || '1.0.0'
      }, { status: 503, headers: NO_STORE });
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: { conductor: 'available' },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    }, { headers: NO_STORE });

  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Service check failed',
      version: process.env.npm_package_version || '1.0.0'
    }, { status: 503, headers: NO_STORE });
  }
}
