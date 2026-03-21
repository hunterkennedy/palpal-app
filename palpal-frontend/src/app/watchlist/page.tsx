export const dynamic = 'force-dynamic';

import Navbar from '@/components/Navbar';
import WatchlistPage from '@/components/WatchlistPage';
import { getEpisodes, getPodcasts } from '@/lib/conductor';
import { PodcastConfig } from '@/types/podcast';
import Footer from '@/components/Footer';

export default async function Watchlist() {
  const [episodes, rawPodcasts] = await Promise.all([
    getEpisodes().catch(() => []),
    getPodcasts().catch(() => []),
  ]);

  const podcasts: PodcastConfig[] = rawPodcasts.map(p => ({
    id: p.id,
    displayName: p.display_name,
    description: p.description || '',
    image: p.has_icon ? `/api/podcast-image/${p.id}` : '',
    socialSections: (p.social_sections || []).map(section => ({
      title: section.title,
      titleColor: section.titleColor,
      links: section.links.map(link => ({
        site: link.site,
        title: link.title,
        link: link.link,
        icon: null,
        hoverColor: link.hoverColor,
      })),
    })),
    enabled: true,
    order: p.display_order,
  }));

  return (
    <div className="page-container">
      <Navbar currentPage="watchlist" />

      <div className="content-container">
        <WatchlistPage initialEpisodes={episodes} initialPodcasts={podcasts} />
      </div>

      <Footer />
    </div>
  );
}
