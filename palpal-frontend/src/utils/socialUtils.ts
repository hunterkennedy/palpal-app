/**
 * Utility functions for social media link handling
 */

import { SocialLinkData, SocialIcons } from '@/components/SocialLink';

// Convert podcast config social links to SocialLinkData format
export const convertToSocialLinkData = (link: SocialLinkData): SocialLinkData => {
  const iconMap: Record<string, React.ReactNode> = {
    youtube: SocialIcons.YouTube,
    patreon: SocialIcons.Patreon,
    twitch: SocialIcons.Twitch,
    website: SocialIcons.Website,
    github: SocialIcons.GitHub,
    linkedin: SocialIcons.LinkedIn,
  };

  return {
    site: link.site,
    title: link.title,
    link: link.link,
    icon: iconMap[link.site.toLowerCase()] || SocialIcons.Website,
    hoverColor: link.hoverColor || 'hover:text-gray-400'
  };
};