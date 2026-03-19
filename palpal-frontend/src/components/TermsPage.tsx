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
          <h2 className="section-title">Acceptance of Terms</h2>
          <p className="section-text">
            By accessing and using palpal, you accept and agree to be bound by the terms and provisions of this
            agreement. If you do not agree, please do not use this service.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Open Source</h2>
          <p className="section-text mb-4">
            palpal is open source software. The source code is freely available on GitHub and licensed accordingly —
            you are welcome to read it, fork it, and run your own instance.
          </p>
          <p className="section-text">
            While the code is open, use of this hosted instance is subject to these terms. In particular, please don't
            use it in ways that would degrade the experience for other users, such as automated scraping or excessive
            automated queries.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Content and Search Results</h2>
          <p className="section-text mb-4">
            palpal provides search functionality for podcast transcripts. I do not claim ownership of the podcast
            content — all rights remain with the original creators.
          </p>
          <p className="section-text">
            Search results are provided for informational and entertainment purposes only. Users are encouraged to
            listen to the full episodes and support the original podcast creators.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Disclaimer</h2>
          <p className="section-text">
            palpal is a personal project provided as-is, free of charge. I make no guarantees about uptime,
            accuracy of transcripts, or completeness of the index. Use it as a helpful tool, but don't rely on
            it for anything critical.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Limitations</h2>
          <p className="section-text">
            I am not liable for any damages arising from the use or inability to use palpal. This is a free,
            personally-maintained service and is provided without warranty of any kind.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Accuracy of Materials</h2>
          <p className="section-text">
            The materials appearing on palpal could include technical, typographical, or photographic errors.
            I do not warrant that any of the materials on this site are accurate, complete, or current, and may
            make changes at any time without notice.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Modifications</h2>
          <p className="section-text">
            I may revise these terms at any time without notice. By using this site, you are agreeing to be bound
            by the then current version of these terms.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section className="text-center pt-2">
          <h2 className="section-title">Contact</h2>
          <p className="section-text mb-6">
            If you have any questions about these Terms of Service, please get in touch.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="btn-primary">
            {CONTACT_EMAIL}
          </a>
        </section>

      </div>
    </div>
  );
}
