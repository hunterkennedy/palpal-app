'use client';

export default function AboutPage() {
  return (
    <div>
      {/* Page Header */}
      <div className="mb-12">
        <h1 className="heading-primary">
          About palpal
        </h1>
      </div>

      {/* Main Content */}
      <div className="section-container">
        {/* Story Section */}
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">The Story</h2>
            <div className="text-body space-y-4">
              <p>
                Welcome to palpal, the podcast search engine!
              </p>
              <p> This site was originally made as a search engine for Podcast About List (i.e. PAL-pal).
                I really wanted to find a bit where Pierce was talking about roasting marshmallows, and expressing frustration in people that burn them for fun.
                Something about smores, or marshmallows, or more dexterity, or something along those lines. It wasn't easy to find clips or transcripts for PAL,
                so I kind of just gave up.
              </p>
              <p>
                But eventually I thought, "I could probably just made some script to search, or a search site" and that's how this was born!
                I have created a pipeline to download, transcribe, and process transcripts from podcasts and push them to this app. Originally, the only podcasts supported were
                Pod About List and Joe Box, but now it supports a wide array of pods using Mielesearch's multi-index mode.
              </p>
            </div>
          </div>
        </section>

        {/* Search Tips */}
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Search Tips</h2>
            <div className="text-body space-y-4">
              <p>
                palpal uses Meilisearch for intelligent search. Here are some tips to get better results:
              </p>

              <div className="space-y-4 ml-2">
                <div>
                  <h3 className="heading-tertiary">🔍 Use Quotes for Exact Phrases</h3>
                  <p className="text-meta">
                    To find an exact sequence of words, wrap them in double quotes.
                    <br />
                    For example, <code>"there's multiple"</code> will only find results where those two words appear together in that order.
                  </p>
                </div>

                <div>
                  <h3 className="heading-tertiary">➖ Exclude Words with a Minus Sign</h3>
                  <p className="text-meta">
                    You can exclude results that contain a specific word by putting a hyphen (<code>-</code>) directly in front of it.
                    <br />
                    For example, <code>eating -poop</code> will find content about eating that does not mention poop.
                  </p>
                </div>

                <div>
                  <h3 className="heading-tertiary">✍️ By Default, All Words Are Searched</h3>
                  <p className="text-meta">
                    If you search for multiple words without quotes, results must contain <strong>all</strong> of those words, but not necessarily together.
                    <br />
                    A search for <code>even a peppermint</code> will match content that includes both "even" and "peppermint" anywhere in the text.
                  </p>
                </div>

                <div>
                  <h3 className="heading-tertiary">⚡️ Typos Are OK</h3>
                  <p className="text-meta">
                    Our search is typo-tolerant, so don't worry about perfect spelling.
                    <br />
                    A search for <code>marshmellow</code> will still find results for "marshmallow".
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* Technical Overview */}
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Technical Overview</h2>
            <div className="text-body space-y-4">
              <p>
                palpal is built with modern web technologies to deliver fast, intelligent search capabilities:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a href="https://nextjs.org/" target="_blank" rel="noopener noreferrer" className="card-secondary hover:scale-[1.02] transition-transform duration-200 cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🚀 <span className="text-orange-400 group-hover:text-orange-300 transition-colors">Next.js</span></h3>
                  <p className="text-meta">React framework for the frontend and API</p>
                </a>
                <a href="https://www.postgresql.org/" target="_blank" rel="noopener noreferrer" className="card-secondary hover:scale-[1.02] transition-transform duration-200 cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🔍 <span className="text-orange-400 group-hover:text-orange-300 transition-colors">PostgreSQL</span></h3>
                  <p className="text-meta">Full-text search via tsvector/tsquery</p>
                </a>
                <a href="https://github.com/m-bain/whisperX" target="_blank" rel="noopener noreferrer" className="card-secondary hover:scale-[1.02] transition-transform duration-200 cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🎤 <span className="text-orange-400 group-hover:text-orange-300 transition-colors">WhisperX</span></h3>
                  <p className="text-meta">GPU accelerated AI transcription</p>
                </a>
                <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer" className="card-secondary hover:scale-[1.02] transition-transform duration-200 cursor-pointer">
                  <h3 className="heading-tertiary mb-2">📺 <span className="text-orange-400 group-hover:text-orange-300 transition-colors">yt-dlp</span></h3>
                  <p className="text-meta">Youtube downloader/archive management</p>
                </a>
                <a href="https://github.com/patrickkfkan/patreon-dl" target="_blank" rel="noopener noreferrer" className="card-secondary hover:scale-[1.02] transition-transform duration-200 cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🎯 <span className="text-orange-400 group-hover:text-orange-300 transition-colors">patreon-dl</span></h3>
                  <p className="text-meta">Patreon post information and management</p>
                </a>
                <a href="https://www.docker.com/" target="_blank" rel="noopener noreferrer" className="card-secondary hover:scale-[1.02] transition-transform duration-200 cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🐳 <span className="text-orange-400 group-hover:text-orange-300 transition-colors">Docker</span></h3>
                  <p className="text-meta">I hardly know her!</p>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Credits Section */}
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Credits</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="card-secondary">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full" style={{backgroundColor: 'var(--accent-secondary)'}}></div>
                  <div>
                    <h3 className="heading-tertiary mb-0">Hunter Kennedy</h3>
                    <p className="text-meta">Development</p>
                  </div>
                </div>
              </div>
              <div className="card-secondary">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full" style={{backgroundColor: 'var(--accent-secondary)'}}></div>
                  <div>
                    <h3 className="heading-tertiary mb-0">Courtney Carpenter</h3>
                    <p className="text-meta">Logo and Title Images</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section>
          <div className="card-elevated" style={{background: 'linear-gradient(to right, rgba(251, 146, 60, 0.1), rgba(249, 115, 22, 0.1))', borderColor: 'var(--border-accent)'}}>
            <div className="text-center">
              <h2 className="heading-secondary">Get In Touch</h2>
              <p className="text-body mb-6">
                Suggestions? Gripes or grievances? Want something similar? Contact me!
              </p>
              <a
                href="mailto:contact@hunterkennedy.net"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                Contact Me
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}