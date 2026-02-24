import { PodcastConfig, PodcastSource } from '@/types/podcast';
import { SocialIcons } from '@/components/SocialLink';

// Types for raw JSON config before processing
interface RawSocialLink {
  site: string;
  title: string;
  link: string;
  icon: string; // This will be a string key that maps to SocialIcons
  hoverColor: string;
}

interface RawSocialSection {
  title: string;
  titleColor: string;
  links: RawSocialLink[];
}

interface RawPodcastConfig {
  id: string;
  displayName: string;
  description: string;
  indexName: string;
  image: string;
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    gradientFrom: string;
    gradientTo: string;
  };
  socialSections: RawSocialSection[];
  sources: unknown[]; // The JSON includes sources which we don't need in the final config
  enabled: boolean;
  order?: number; // Optional in JSON, will have default if missing
}

// Import all podcast configs statically at build time
import palConfig from '@/config/podcasts/pal.json';
import joeboxConfig from '@/config/podcasts/joe-box.json';
import fearAndConfig from '@/config/podcasts/fear-and.json';
import theYardConfig from '@/config/podcasts/the-yard.json';
import wineAboutItConfig from '@/config/podcasts/wine-about-it.json';
import joyTacticsConfig from '@/config/podcasts/joy-tactics.json';

const rawConfigs: RawPodcastConfig[] = [
  palConfig as RawPodcastConfig,
  joeboxConfig as RawPodcastConfig,
  fearAndConfig as RawPodcastConfig,
  theYardConfig as RawPodcastConfig,
  wineAboutItConfig as RawPodcastConfig,
  joyTacticsConfig as RawPodcastConfig,
];

// Process configs to map icon strings to components
const processConfig = (config: RawPodcastConfig, defaultOrder: number): PodcastConfig => {
  return {
    ...config,
    order: config.order ?? defaultOrder, // Use config order or fall back to default
    sources: config.sources as PodcastSource[], // Include sources from raw config
    theme: {
      ...config.theme,
      // Add default values for missing theme properties
      background: 'gray-900',
      textPrimary: 'white',
      textSecondary: 'gray-300',
      border: 'gray-600'
    },
    socialSections: config.socialSections.map((section: RawSocialSection) => ({
      ...section,
      links: section.links.map((link: RawSocialLink) => ({
        site: link.site,
        title: link.title,
        link: link.link,
        hoverColor: link.hoverColor,
        icon: SocialIcons[link.icon as keyof typeof SocialIcons] || SocialIcons.Website
      }))
    }))
  };
};

// Pre-processed podcast configurations (compiled at build time)
export const STATIC_PODCAST_CONFIGS: PodcastConfig[] = rawConfigs
  .map((config, index) => processConfig(config, index * 10)) // Default order: 0, 10, 20, 30, 40
  .sort((a, b) => a.order - b.order); // Sort by order field

// Helper functions
export function getStaticPodcastConfig(podcastId: string): PodcastConfig | null {
  return STATIC_PODCAST_CONFIGS.find(config => config.id === podcastId) || null;
}

export function getAllStaticPodcastConfigs(): PodcastConfig[] {
  return STATIC_PODCAST_CONFIGS;
}

// Default podcast (PAL)
export const DEFAULT_PODCAST_ID = 'pal';
export const DEFAULT_PODCAST_CONFIG = getStaticPodcastConfig(DEFAULT_PODCAST_ID);