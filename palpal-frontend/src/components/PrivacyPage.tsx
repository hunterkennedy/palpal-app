'use client';

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@palpal.app';

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="mb-10">
        <h1 className="heading-primary">Privacy Policy</h1>
        <p className="text-body mt-2">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="section-card space-y-8">

        <section>
          <h2 className="section-title">What I Collect</h2>
          <p className="section-text mb-4">
            palpal logs search queries and IP addresses. This is standard web server behaviour and helps me understand
            how the service is being used and diagnose problems.
          </p>
          <p className="section-text">
            I don't run any analytics platform, ad network, or tracking scripts. There are no third-party cookies.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Your Saved Content</h2>
          <p className="section-text">
            Saved clips and watchlist items are stored in your browser's local storage. This data never leaves your
            device and I have no access to it. You can clear it at any time through your browser settings.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Data Sharing</h2>
          <p className="section-text">
            I don't sell or share your data. Logs are stored on the server that runs palpal and are not passed to
            any third party.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Podcast Content</h2>
          <p className="section-text">
            palpal indexes podcast content for search purposes only. I don't claim ownership of any of it — all
            rights remain with the original creators. If you'd like your content removed from the index, get in touch.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Changes to This Policy</h2>
          <p className="section-text">
            If I make meaningful changes to this policy, I'll update the date at the top of this page.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section className="text-center pt-2">
          <h2 className="section-title">Questions?</h2>
          <p className="section-text mb-6">
            If you have any questions about this policy or your data, feel free to reach out.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="btn-primary">
            Contact Me
          </a>
        </section>

      </div>
    </div>
  );
}
