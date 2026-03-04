import { NextResponse } from 'next/server';
import { checkHealth } from '@/lib/conductor';

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
      }, { status: 503 });
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: { conductor: 'available' },
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
