import { SocialLinkData } from '@/components/SocialLink';

export interface PodcastSocialSection {
  title: string;
  links: SocialLinkData[];
}

export interface PodcastSource {
  site: string;
  name: string;
  url: string;
  type: string;
  enabled: boolean;
  fetch?: string | null;
}

export interface PodcastConfig {
  id: string;
  displayName: string;
  description: string;
  indexName: string;
  image: string;
  socialSections: PodcastSocialSection[];
  sources: PodcastSource[];
  enabled: boolean;
  order: number;
}
