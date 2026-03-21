import { SocialLinkData } from '@/components/SocialLink';

export interface PodcastSocialSection {
  title: string;
  links: SocialLinkData[];
}

export interface PodcastConfig {
  id: string;
  displayName: string;
  image: string;
  socialSections: PodcastSocialSection[];
  enabled: boolean;
  order: number;
}
