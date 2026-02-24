'use client';

export default function PrivacyPage() {
  return (
    <div>
      {/* Page Header */}
      <div className="mb-12">
        <h1 className="heading-primary">
          Privacy Policy
        </h1>
        <p className="text-xl text-body">
          Last updated: {new Date().toLocaleDateString()}
        </p>
      </div>

      {/* Main Content */}
      <div className="section-container">
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Information We Collect</h2>
            <div className="text-body space-y-4">
              <p>
                palpal is designed with privacy in mind. We collect minimal information necessary to provide our search service:
              </p>
              <div className="card-secondary">
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <div>
                      <strong className="text-white">Search Queries:</strong> We may temporarily log search queries to improve our service and fix issues
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <div>
                      <strong className="text-white">Saved Content:</strong> Content you choose to save is stored locally in your browser
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <div>
                      <strong className="text-white">Technical Data:</strong> Basic server logs including IP addresses, timestamps, and error information
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">How We Use Information</h2>
            <div className="text-body space-y-4">
              <p>The information we collect is used to:</p>
              <div className="card-secondary">
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Provide and improve our search functionality</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Troubleshoot technical issues</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Understand usage patterns to enhance the user experience</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Maintain the security and integrity of our service</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Local Storage</h2>
            <p className="text-body">
              Your saved content and search preferences are stored locally in your browser using cookies and local storage.
              This data never leaves your device unless you explicitly choose to share it. You can clear this data at any
              time through your browser settings.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Data Sharing</h2>
            <p className="text-body">
              We do not sell, trade, or otherwise transfer your personal information to third parties. This does not include
              trusted third parties who assist me in operating this website, conducting this business, or serving users,
              so long as those parties agree to keep this information confidential.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Podcast Content</h2>
            <p className="text-body">
              palpal indexes podcast content for search purposes. We do not claim ownership of this content.
              All rights remain with the original podcast creators. If you are a content creator and wish to have your content
              removed from the index, please contact me.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Analytics</h2>
            <p className="text-body">
              We may use analytics tools to understand how our service is used. These tools may collect information such as
              how often users visit our site, what pages they visit, and what other sites they used prior to coming to our site.
              We use this information only to improve our service.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Security</h2>
            <p className="text-body">
              We implement appropriate security measures to protect against unauthorized access, alteration, disclosure,
              or destruction of your personal information. However, no method of transmission over the Internet or electronic
              storage is 100% secure.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Changes to This Policy</h2>
            <p className="text-body">
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new
              Privacy Policy on this page and updating the "Last updated" date at the top of this policy.
            </p>
          </div>
        </section>
        <section>
          <div className="card-elevated" style={{background: 'linear-gradient(to right, rgba(251, 146, 60, 0.1), rgba(249, 115, 22, 0.1))', borderColor: 'var(--border-accent)'}}>
            <div className="text-center">
              <h2 className="heading-secondary">Contact Me</h2>
              <p className="text-body mb-6">
                If you have any questions about this Privacy Policy or privacy practices, please contact me:
              </p>
              <a
                href="mailto:contact@hunterkennedy.net"
                className="btn-primary"
              >
                contact@hunterkennedy.net
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}