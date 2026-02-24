'use client';

export default function TermsPage() {
  return (
    <div>
      {/* Page Header */}
      <div className="mb-12">
        <h1 className="heading-primary">
          Terms of Service
        </h1>
        <p className="text-xl text-body">
          Last updated: {new Date().toLocaleDateString()}
        </p>
      </div>

      {/* Main Content */}
      <div className="section-container">
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Acceptance of Terms</h2>
            <p className="text-body">
              By accessing and using palpal, you accept and agree to be bound by the terms and provision of this agreement.
              If you do not agree to abide by the above, please do not use this service.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Use License</h2>
            <div className="text-body space-y-4">
              <p>
                Permission is granted to temporarily access palpal for personal, non-commercial transitory viewing only.
                This is the grant of a license, not a transfer of title, and under this license you may not:
              </p>
              <div className="card-secondary">
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Modify or copy the materials</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Use the materials for any commercial purpose or for any public display</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Attempt to reverse engineer any software contained on the website</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-2 bg-orange-500"></div>
                    <span>Remove any copyright or other proprietary notations from the materials</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Content and Search Results</h2>
            <div className="text-body space-y-4">
              <p>
                palpal provides search functionality for podcast transcripts.
                We do not claim ownership of the podcast content and all rights remain with the original creators.
              </p>
              <p>
                Search results are provided for informational and entertainment purposes only. Users are encouraged to
                listen to the full episodes and support the original podcast creators.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Disclaimer</h2>
            <p className="text-body">
              The materials on palpal are provided on an 'as is' basis. palpal makes no warranties, expressed or implied,
              and hereby disclaims and negates all other warranties including, without limitation, implied warranties or
              conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property
              or other violation of rights.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Limitations</h2>
            <p className="text-body">
              In no event shall palpal or its suppliers be liable for any damages (including, without limitation, damages
              for loss of data or profit, or due to business interruption) arising out of the use or inability to use the
              materials on palpal, even if palpal or an authorized representative has been notified orally or in writing
              of the possibility of such damage.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Accuracy of Materials</h2>
            <p className="text-body">
              The materials appearing on palpal could include technical, typographical, or photographic errors.
              palpal does not warrant that any of the materials on its website are accurate, complete, or current.
              palpal may make changes to the materials contained on its website at any time without notice.
            </p>
          </div>
        </section>

        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Modifications</h2>
            <p className="text-body">
              palpal may revise these terms of service for its website at any time without notice.
              By using this website, you are agreeing to be bound by the then current version of these terms of service.
            </p>
          </div>
        </section>

        <section>
          <div className="card-elevated" style={{background: 'linear-gradient(to right, rgba(251, 146, 60, 0.1), rgba(249, 115, 22, 0.1))', borderColor: 'var(--border-accent)'}}>
            <div className="text-center">
              <h2 className="heading-secondary">Contact Information</h2>
              <p className="text-body mb-6">
                If you have any questions about these Terms of Service, please contact me:
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