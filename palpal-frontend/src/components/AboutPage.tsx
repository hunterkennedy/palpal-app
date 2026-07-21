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
                palpal started as a search engine for Podcast About List — hence PAL-pal. I really wanted to find a bit where Pierce was talking about roasting marshmallows, and his frustration with people who burn them on purpose. Something about s'mores, marshmallows, dexterity.
              </p>
              <p>
                Originally, I used a script to handle the download, transcription, and chunking that I would just run on my PC. The site was also self hosted, so I could keep those endpoints local. But I didn't really like having that hole in my internet, and also didn't want to keep having to manually run a script. The script was also terrible and had no resuming, error detection or handling, or segmentation of tasks.
              </p>
              <p>The first version of this site used a DB called Mielesearch. Mielesearch is slick, and works great for semantic search and in general is super forgiving on search queries. The problem is that it kind of sucked at being a normal DB. I also couldn't really interact with it in a normal SQL way. And I couldn't be bothered to learn.
              </p>
              <p>
                The current stack uses a decoupled worker/manager/frontend/db model. The frontent is a simple Next.js app that reaches out to the postgres DB. Jobs like discovery, downloading, and transcribing are sent to the worker (blurb, see below) which can run on any PC with a GPU. blurb scans for new uploads, then downloads and transcribes the tracks, and then posts it back to the manager The manager (in the code named 'conductor') handles the processing and chunking of the transcript, and drops it into the postgres db. Conductor is a pretty simple FastAPI app written in Python.
              </p>
              <p>
                So in terms of who talks to who, it looks a bit like this:
              </p>
              <p>
                blurb worker --- conductor --- db --- frontend --- YOU
              </p>
              <p>
                I love PAL and Joe Box and hope that I can help fellow fans with finding their favorite bits. I am a software engineer for my real life job, and this a passion project. I do not and will not host ads. I feel very lucky to be able to make crap like this.
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

              <div>
                  <h3 className="heading-tertiary">✍️ By Default, All Words Are Searched</h3>
                  <p className="text-meta">
                    If you search for multiple words without quotes, results must contain <strong>all</strong> of those words, but not necessarily together.
                    <br />
                    A search for <code>even a peppermint</code> will match content that includes both "even" and "peppermint" anywhere in the text.
                  </p>
                </div>

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
                  <p className="text-meta">GPU accelerated AI transcription (via blurb)</p>
                </a>
                <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer" className="card-secondary cursor-pointer">
                  <h3 className="heading-tertiary mb-2">📺 <span className="text-orange-400">yt-dlp</span></h3>
                  <p className="text-meta">Youtube downloader/archive management</p>
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
          <div className="card-elevated" style={{ background: 'linear-gradient(to right, rgba(251, 146, 60, 0.1), rgba(249, 115, 22, 0.1))', borderColor: 'var(--border-accent)' }}>
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