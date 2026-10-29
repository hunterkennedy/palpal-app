'use client';

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@palpal.app';
const LAST_UPDATED = 'October 29, 2026';

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="mb-10">
        <h1 className="heading-primary">Privacy Policy</h1>
        <p className="text-body mt-2">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="section-card space-y-8">

        <section>
          <h2 className="section-title">Who Is Responsible</h2>
          <p className="section-text">
            palpal is operated by Hunter Kennedy in the United States. I am the controller responsible for the
            processing described in this policy. You can contact me at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-orange-300 transition-colors duration-200">
              {CONTACT_EMAIL}
            </a>.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">What I Collect</h2>
          <p className="section-text mb-4">
            palpal keeps short-lived application logs for security and troubleshooting. Those logs record the requested
            path, time, and response status. Search terms and IP addresses are not written to palpal&apos;s application logs.
          </p>
          <p className="section-text mb-4">
            To prevent abuse, palpal temporarily processes your IP address in memory, for example to enforce rate limits.
            It is not stored in the database or written to disk. The hosting and network providers described below may
            process connection data such as IP addresses as part of normal network operations.
          </p>
          <p className="section-text">
            I don&apos;t run any analytics platform, ad network, or tracking scripts. There are no analytics cookies or
            third-party cookies. I process this technical data on the basis of legitimate interests: keeping the service
            secure, available, and working correctly.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Your Saved Content and Preferences</h2>
          <p className="section-text">
            Your selected podcasts, saved clips, watchlist, notes, and theme preference are stored in your browser&apos;s
            local storage. This data never leaves your device and I have no access to it. You can clear it at any time
            through your browser settings.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Cookies</h2>
          <p className="section-text">
            palpal does not set cookies for regular visitors. The admin login sets a strictly necessary session cookie
            for authenticated administrators only. It is HttpOnly, Secure in production, and SameSite=Strict.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Data Sharing</h2>
          <p className="section-text mb-4">
            I don&apos;t sell or share your data. palpal is hosted by Ionos in the United States. Cloudflare provides DNS,
            CDN, and secure tunnel services. These providers process technical connection data on my behalf as part of
            running the service, under their own privacy and data-processing terms. Because search terms appear in the
            page and API URLs, these providers may process them as part of routing requests.
          </p>
          <p className="section-text">
            If you are in the EEA or UK, this means technical data may be transferred to the United States. Where
            required, I rely on the providers&apos; standard contractual clauses and Data Privacy Framework
            certifications.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Data Retention</h2>
          <p className="section-text">
            Application logs are rotated at a fixed maximum size, so older entries are discarded automatically. Data in
            your browser&apos;s local storage stays on your device until you clear it.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Your Rights</h2>
          <p className="section-text">
            If you are in the EEA or UK, you have the right to access, rectify, erase, restrict, or object to the
            processing of your personal data, and the right to data portability. You can also lodge a complaint with your
            local supervisory authority. Because palpal does not maintain user accounts or analytics profiles, I may not
            be able to identify a specific record about you; if that happens, I will explain why. To exercise these
            rights, contact me.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Podcast Content</h2>
          <p className="section-text">
            palpal indexes podcast content for search purposes only. I don&apos;t claim ownership of any of it; all
            rights remain with the original creators. If you&apos;d like your content removed from the index, please contact me.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Changes to This Policy</h2>
          <p className="section-text">
            If I make meaningful changes to this policy, I&apos;ll update the date at the top of this page.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section className="text-center pt-2">
          <h2 className="section-title">Questions?</h2>
          <p className="section-text mb-6">
            If you have any questions about this policy or your data, please contact me.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="btn-primary">
            Contact Me
          </a>
        </section>

      </div>
    </div>
  );
}
