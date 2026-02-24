import { SocialLinkData } from '@/components/SocialLink';

export interface PodcastTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  gradientFrom: string;
  gradientTo: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
}

export interface PodcastSocialSection {
  title: string;
  titleColor: string;
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
  theme: PodcastTheme;
  socialSections: PodcastSocialSection[];
  sources: PodcastSource[];
  enabled: boolean;
  order: number; // Lower numbers appear first
}