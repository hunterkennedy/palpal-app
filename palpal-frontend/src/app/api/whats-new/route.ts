import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

export async function GET() {
  try {
    // Read the what's new content from a file
    const contentPath = join(process.cwd(), 'content', 'whats-new.html');
    const content = await readFile(contentPath, 'utf-8');

    // Create version hash from content + file modification time
    const { stat } = await import('fs/promises');
    const stats = await stat(contentPath);
    const versionInput = content + stats.mtime.getTime().toString();
    const version = createHash('md5').update(versionInput).digest('hex').substring(0, 8);

    return NextResponse.json({
      content,
      version,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reading what\'s new content:', error);

    return NextResponse.json({
      content: '<p>No updates available at this time.</p>',
      version: '0',
      timestamp: new Date().toISOString()
    });
  }
}