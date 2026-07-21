import { z } from 'zod';

/**
 * Extract the client IP for rate-limiting. `x-forwarded-for` is a comma-separated
 * hop chain; earlier entries are whatever the client itself sent and can be
 * spoofed freely (an attacker can rotate them per-request to dodge the rate
 * limit). Exactly one reverse proxy sits in front of this app (see
 * docker-compose.prod.yml — ports are bound to 127.0.0.1 only), and that proxy
 * appends the real connecting IP as the last hop, which the client cannot forge
 * without breaking the TCP handshake. So the last entry is the one to trust.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(h => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return request.headers.get('x-real-ip') || 'anonymous';
}

export const searchSchema = z.object({
  q: z.string()
    .max(500, 'Search query too long'),
  limit: z.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(10)
});

export const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
let lastPrune = Date.now();

export function checkRateLimit(ip: string, maxRequests = 100, windowMs = 60000): boolean {
  const now = Date.now();

  // Prune expired entries every 5 minutes to prevent unbounded growth
  if (now - lastPrune > 5 * 60 * 1000) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetTime) rateLimitMap.delete(key);
    }
    lastPrune = now;
  }

  const userLimit = rateLimitMap.get(ip);

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (userLimit.count >= maxRequests) {
    return false;
  }

  userLimit.count++;
  return true;
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .trim();
}