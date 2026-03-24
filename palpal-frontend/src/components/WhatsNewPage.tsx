import sanitizeHtml from 'sanitize-html';
import type { WhatsNewEntry } from '@/lib/conductor';

interface WhatsNewPageProps {
  entries: WhatsNewEntry[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function WhatsNewPage({ entries }: WhatsNewPageProps) {
  return (
    <div>
      <div className="mb-12">
        <h1 className="heading-primary">What's New</h1>
      </div>

      <div className="section-container">
        {entries.length === 0 ? (
          <div className="card-primary">
            <p className="text-body">Nothing to show yet.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <section key={entry.id}>
              <div className="card-primary">
                <div className="text-meta mb-3">{formatDate(entry.posted_at)}</div>
                <div
                  className="text-body"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.content) }}
                />
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
