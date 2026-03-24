'use client';

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@palpal.app';

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="mb-10">
        <h1 className="heading-primary">Terms of Service</h1>
        <p className="text-body mt-2">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="section-card space-y-8">

        <section>
          <h2 className="section-title">What palpal Is</h2>
          <p className="section-text">
            palpal is a free, personally-maintained search engine for podcast transcripts. It's a side project —
            not a commercial service. Use it as a helpful tool, but don't rely on it for anything critical. I make
            no guarantees about uptime, transcript accuracy, or completeness of the index.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Content</h2>
          <p className="section-text">
            palpal indexes podcast content for search purposes only. I don't own any of it — all rights remain
            with the original creators. Search results are meant to help you find moments in episodes, not
            replace listening to them. Please support the creators whose work you enjoy.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Fair Use</h2>
          <p className="section-text">
            Please don't use palpal in ways that would degrade the experience for others — automated scraping,
            bulk queries, or anything that puts unusual load on the service. The code is open source and available
            on GitHub if you want to run your own instance.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">No Warranty</h2>
          <p className="section-text">
            palpal is provided as-is, free of charge, with no warranty of any kind. I'm not liable for any
            damages arising from its use or unavailability.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Changes</h2>
          <p className="section-text">
            I may update these terms from time to time. The date at the top of this page reflects the last revision.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section className="text-center pt-2">
          <h2 className="section-title">Questions?</h2>
          <p className="section-text mb-6">
            If you have any questions about these terms, feel free to reach out.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="btn-primary">
            Contact Me
          </a>
        </section>

      </div>
    </div>
  );
}
