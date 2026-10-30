'use client';

import { useEffect, useState } from 'react';
import {
  getAnalyticsOptOutPreference,
  hasBrowserPrivacySignal,
  setAnalyticsOptOut,
} from '@/lib/analytics';

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@palpal.app';
const LAST_UPDATED = 'October 29, 2026';

export default function PrivacyPage() {
  const [analyticsOptOut, setAnalyticsOptOutState] = useState<boolean | null>(null);
  const [privacySignal, setPrivacySignal] = useState(false);

  useEffect(() => {
    setAnalyticsOptOutState(getAnalyticsOptOutPreference());
    setPrivacySignal(hasBrowserPrivacySignal());
  }, []);

  const toggleAnalytics = () => {
    if (analyticsOptOut === null || privacySignal) return;
    const next = !analyticsOptOut;
    setAnalyticsOptOut(next);
    setAnalyticsOptOutState(next);
  };

  const analyticsOff = privacySignal || analyticsOptOut === true;

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
            To prevent abuse, palpal temporarily processes your IP address in memory, for example to enforce rate limits
            and to estimate unique searchers. It is not stored in the database or written to disk. The hosting and network
            providers described below may process connection data such as IP addresses as part of normal network operations.
          </p>
          <p className="section-text">
            palpal also uses a small first-party analytics system, described below. It does not use third-party analytics,
            advertising, or tracking scripts, and there are no third-party cookies. I process technical data on the basis
            of legitimate interests: keeping the service secure, available, and working correctly.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Search Analytics</h2>
          <p className="section-text mb-4">
            When you submit a search, palpal records the date (not the time), the normalized search text, the number of
            results returned, the podcast filter you used if any, which podcasts appeared in the top results, and which
            outbound watch or listen links were opened. This helps me understand which searches and podcasts are useful.
          </p>
          <p className="section-text mb-4">
            I do not store your IP address, a user ID, a session ID, a cookie ID, a browser fingerprint, your user agent,
            or the page you came from. I do not link a search to a result you opened, and I do not build a profile of you.
            Analytics data is never sold or shared and is not used for advertising.
          </p>
          <p className="section-text mb-4">
            Search text is normalized and obvious personal data such as email addresses, phone numbers, and URLs is
            redacted before storage. Queries are stored as daily aggregates only, not as individual search events. To
            estimate how many different people search each day, I process your IP address in memory and turn it into a
            keyed hash using a random secret that is generated fresh each day and never written to disk. Only the daily
            count is stored. The secret and the in-memory hashes are discarded at the end of the day or when the service
            restarts, so searches cannot be linked across days or back to you. This estimate is approximate: a person
            using several devices may be counted more than once, and several people sharing one connection may be counted
            once.
          </p>
          <p className="section-text mb-4">
            <strong>Legal basis:</strong> legitimate interests (Article 6(1)(f) GDPR) in understanding aggregate usage so
            I can improve the search index and decide which podcasts to keep. The processing is limited to what is
            described here, is not used for profiling or automated decision-making, and is kept for a short time. You can
            object at any time using the control below, by enabling Global Privacy Control or Do Not Track in your
            browser, or by contacting me.
          </p>

          <div
            className="rounded-2xl border p-4 mt-5"
            style={{
              borderColor: 'rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Analytics for this browser: {analyticsOptOut === null ? 'checking…' : analyticsOff ? 'off' : 'on'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {privacySignal
                    ? 'Your browser is sending Global Privacy Control or Do Not Track, so analytics is off regardless of this setting.'
                    : analyticsOptOut
                      ? 'Future searches from this browser will not be recorded.'
                      : 'You can turn analytics off for this browser at any time.'}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={toggleAnalytics}
                disabled={analyticsOptOut === null || privacySignal}
              >
                {privacySignal
                  ? 'Browser signal active'
                  : analyticsOptOut
                    ? 'Turn analytics back on'
                    : 'Turn off analytics'}
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }}>
              This choice is stored only in this browser&apos;s local storage. It does not affect other devices. Because
              analytics records are aggregate and unlinked, I cannot identify or delete a specific person&apos;s past
              records, but future searches from this browser will not be recorded after you opt out.
            </p>
          </div>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Your Saved Content and Preferences</h2>
          <p className="section-text">
            Your selected podcasts, saved clips, watchlist, notes, theme preference, and analytics opt-out choice are
            stored in your browser&apos;s local storage. This data never leaves your device and I have no access to it.
            You can clear it at any time through your browser settings.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Cookies</h2>
          <p className="section-text">
            palpal does not set cookies for regular visitors. Analytics uses no cookies or device identifiers. Your
            analytics opt-out choice is stored in local storage as a functional preference. The admin login sets a
            strictly necessary session cookie for authenticated administrators only. It is HttpOnly, Secure in
            production, and SameSite=Strict.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Data Sharing</h2>
          <p className="section-text mb-4">
            I don&apos;t sell or share your data. Search analytics is stored in palpal&apos;s own Postgres database; I do
            not use a third-party analytics provider. palpal is hosted by Ionos in the United States. Cloudflare provides
            DNS, CDN, and secure tunnel services. These providers process technical connection data on my behalf as part
            of running the service, under their own privacy and data-processing terms. Because search terms appear in the
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
          <p className="section-text mb-4">
            Search text aggregates are kept for up to 180 days. Daily totals and podcast/clip aggregates are kept for up
            to 730 days. The in-memory visitor hashes used to estimate daily unique searchers are discarded within 24
            hours or when the service restarts.
          </p>
          <p className="section-text">
            Application logs are rotated at a fixed maximum size, so older entries are discarded automatically. Data in
            your browser&apos;s local storage stays on your device until you clear it. I do not currently keep separate
            database backups.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Your Rights</h2>
          <p className="section-text">
            If you are in the EEA or UK, you have the right to access, rectify, erase, restrict, or object to the
            processing of your personal data, and the right to data portability. You can object to analytics using the
            control above, by enabling Global Privacy Control or Do Not Track in your browser, or by contacting me. You
            can also lodge a complaint with your local supervisory authority. Because palpal does not maintain user
            accounts or analytics profiles, I may not be able to identify a specific record about you; if that happens, I
            will explain why.
          </p>
        </section>

        <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <section>
          <h2 className="section-title">Children</h2>
          <p className="section-text">
            palpal is not directed at children under 16, and I do not knowingly collect personal data from children.
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
            If I make meaningful changes to this policy, I&apos;ll update the date at the top of this page and announce
            material changes on the What&apos;s New page.
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
