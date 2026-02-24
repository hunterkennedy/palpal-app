import { PodcastConfig } from '@/types/podcast';
import { SocialIcons } from '@/components/SocialLink';
import fs from 'fs';
import path from 'path';

const PODCASTS_DIR = path.join(process.cwd(), 'src/config/podcasts');

// Cache for podcast configurations
let podcastCache: Map<string, PodcastConfig> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 0; // Disable cache for debugging

export async function loadPodcastConfig(podcastId: string): Promise<PodcastConfig | null> {
  try {
    const configPath = path.join(PODCASTS_DIR, `${podcastId}.json`);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData) as PodcastConfig;

    // Map icon strings to actual icon components
    config.socialSections = config.socialSections.map(section => ({
      ...section,
      links: section.links.map(link => ({
        ...link,
        icon: SocialIcons[link.icon as keyof typeof SocialIcons] || SocialIcons.Website
      }))
    }));

    return config;
  } catch (error) {
    console.error(`Error loading podcast config for ${podcastId}:`, error);
    return null;
  }
}

export async function loadAllPodcastConfigs(): Promise<PodcastConfig[]> {
  const now = Date.now();

  // Return cached data if still valid
  if (podcastCache && (now - cacheTimestamp) < CACHE_TTL) {
    const cached = Array.from(podcastCache.values()).filter(config => config.enabled);
    return cached;
  }

  try {
    const configFiles = fs.readdirSync(PODCASTS_DIR)
      .filter(file => file.endsWith('.json'));


    const configs: PodcastConfig[] = [];
    const newCache = new Map<string, PodcastConfig>();

    for (const file of configFiles) {
      const podcastId = path.basename(file, '.json');
      const config = await loadPodcastConfig(podcastId);

      if (config) {
        configs.push(config);
        newCache.set(podcastId, config);
      }
    }

    // Update cache
    podcastCache = newCache;
    cacheTimestamp = now;

    const enabledConfigs = configs.filter(config => config.enabled);
    return enabledConfigs;
  } catch (error) {
    console.error('Error loading podcast configurations:', error);
    return [];
  }
}

export async function getPodcastConfig(podcastId: string): Promise<PodcastConfig | null> {
  const now = Date.now();

  // Check cache first
  if (podcastCache && (now - cacheTimestamp) < CACHE_TTL && podcastCache.has(podcastId)) {
    return podcastCache.get(podcastId) || null;
  }

  // Load from file
  return loadPodcastConfig(podcastId);
}

export function invalidatePodcastCache(): void {
  podcastCache = null;
  cacheTimestamp = 0;
}

// Default podcast (PAL)
export const DEFAULT_PODCAST_ID = 'pal';