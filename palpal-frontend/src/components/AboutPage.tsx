'use client';

import { Github } from 'lucide-react';
import Image from 'next/image';

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@palpal.app';

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
                palpal started as a search engine for Podcast About List — hence PAL-pal. I really wanted to find a bit where Pierce was talking about roasting marshmallows, and his frustration with people who burn them on purpose. Something about s'mores, marshmallows, dexterity — I couldn't pin it down. It wasn't easy to find clips or transcripts for PAL, so I kind of just gave up.
              </p>
              <p>
                Eventually I thought, "I could probably just make a script to search this." That turned into a pipeline to download, transcribe, and index podcast audio — and that turned into this site. It started with just Pod About List and Joe Box, but now supports a wide array of pods.
              </p>
              <p>
                The site outgrew its original setup pretty quickly. MeiliSearch was the only search backend — a dedicated search engine that had to be kept in sync with everything else. It worked, but it was one more thing to run and one more thing to break. Eventually I realized Postgres could do it all with full-text search built in, so MeiliSearch got the axe and the stack got a lot simpler.
              </p>
              <p>
                The pipeline went through a similar evolution. What started as a loose collection of scripts became palpal-conductor — a little FastAPI app that manages discovery, downloading, and transcription in a queue. The original scripts were so fragile they eventually just broke, and starting fresh was easier. It also meant the whole thing could finally run on a VPS instead of just my machine.
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
                palpal uses full-text search to find what you're looking for. Here are some tips to get better results:
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
                  <h3 className="heading-tertiary">↔️ Use OR for Either/Or Searches</h3>
                  <p className="text-meta">
                    Use the uppercase word <code>OR</code> between terms to match results containing either one.
                    <br />
                    For example, <code>marshmallows OR smores</code> will find content that mentions either word.
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
                palpal is built with modern web technologies to deliver fast, precise full-text search:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a href="https://nextjs.org/" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🚀 <span className="text-orange-400">Next.js</span></h3>
                  <p className="text-meta">React framework for the frontend and API</p>
                </a>
                <a href="https://www.postgresql.org/" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🔍 <span className="text-orange-400">PostgreSQL</span></h3>
                  <p className="text-meta">Full-text search via tsvector/tsquery</p>
                </a>
                <a href="https://github.com/m-bain/whisperX" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🎤 <span className="text-orange-400">WhisperX</span></h3>
                  <p className="text-meta">GPU accelerated AI transcription</p>
                </a>
                <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">📺 <span className="text-orange-400">yt-dlp</span></h3>
                  <p className="text-meta">Youtube downloader/archive management</p>
                </a>
                <a href="https://github.com/patrickkfkan/patreon-dl" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🎯 <span className="text-orange-400">patreon-dl</span></h3>
                  <p className="text-meta">Patreon post information and management</p>
                </a>
                <a href="https://www.docker.com/" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">🐳 <span className="text-orange-400">Docker</span></h3>
                  <p className="text-meta">I hardly know her!</p>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Source Code */}
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Source Code</h2>
            <p className="text-body mb-4">palpal is open source. Check out the code on GitHub:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <a
                href="https://github.com/hunterkennedy/palpal-app"
                target="_blank"
                rel="noopener noreferrer"
                className="card-secondary cursor-pointer"
              >
                <h3 className="heading-tertiary mb-2 flex items-center gap-2">
                  <Github size={16} className="text-orange-400" />
                  <span className="text-orange-400">palpal-app</span>
                </h3>
                <p className="text-meta">Frontend, conductor pipeline, and infrastructure</p>
              </a>
              <a
                href="https://github.com/hunterkennedy/blurb"
                target="_blank"
                rel="noopener noreferrer"
                className="card-secondary cursor-pointer"
              >
                <h3 className="heading-tertiary mb-2 flex items-center gap-2">
                  <Github size={16} className="text-orange-400" />
                  <span className="text-orange-400">blurb</span>
                </h3>
                <p className="text-meta">GPU-accelerated transcription service</p>
              </a>
            </div>
          </div>
        </section>

        {/* Ko-fi Support */}
        <section>
          <div className="card-primary">
            <h2 className="heading-secondary">Support palpal</h2>
            <p className="text-body mb-6">If you find palpal useful, consider buying me a coffee!</p>
            <div className="flex justify-center">
              <a href="https://ko-fi.com/hunterkennedysoftware" target="_blank" rel="noopener noreferrer">
                <Image src="/support_me_on_kofi_badge_red.png" alt="Support me on Ko-fi" width={223} height={60} />
              </a>
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
                href={`mailto:${CONTACT_EMAIL}`}
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