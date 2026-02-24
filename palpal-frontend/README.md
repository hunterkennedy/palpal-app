# PALpal

A search application for "Podcast About List" transcripts, built with Next.js and Meilisearch with AI-powered semantic search.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ and npm

### Setup Instructions

1. **Clone and navigate to the project:**
```bash
git clone <your-repo>
cd palpal
```

2. **Set up environment variables:**
```bash
cp .env.example .env
```
Edit `.env` and update the `MEILI_MASTER_KEY` with a secure key.

3. **Start app:**
```bash
docker-compose up -d # launches everything
npm run dev # JUST runs the app in hot reload
```
This starts Meilisearch and the Next.js app.

4. **Generate API keys:**
```bash
# Or using Python (requires: pip install meilisearch)
python scripts/generate-search-key.py # TODO rewrite this script
```

5. **Load your transcript data:**
```bash
# Install Python dependencies for transcript processing
pip install -r data/requirements.txt

# Load your own data with the new optimized workflow
python scripts/load-transcript-data.py --update-sources

```

6. **Visit the application:**
Open `http://localhost:3001` in your browser.


### Data Schema

The application expects a `transcripts` index with documents containing:

```typescript
interface TranscriptDocument {
  id: string;
  text: string;
  video_id: string;
  video_title: string;
  start_time: number;
  end_time: number;
  start_formatted: string;
  end_formatted: string;
  duration: number;
  speaker?: string;
  tags?: string[];
}
```

## Adding Your Own Data

### Method 1: Automated Source Updates (Recommended)

Use the enhanced Python-based data management script with the new optimized workflow:

```bash
# First time setup - install Python dependencies
pip install -r data/requirements.txt

# Configure your sources in scripts/sources.json, then run the full workflow:
python scripts/load-transcript-data.py --update-sources
```

**NEW 4-Step Workflow:**
1. **Download**: Audio files saved to `data/download/` using yt-dlp
2. **Transcribe**: Raw transcripts generated in `data/transcripts/` using WhisperX  
3. **Process**: Optimized chunks created in `data/processed/` using transcript_processor.py
4. **Upload**: Only processed transcripts uploaded to database (raw transcripts never touch the DB)

**Key Benefits:**
- **Optimized chunks**: 75-second segments with 15-second overlap for best search performance
- **Safety**: Raw transcripts are never uploaded - only processed, optimized data
- **Traceability**: Complete audit trail from audio → raw → processed → database
- **Resume capability**: Can restart at any stage if interrupted

### Method 2: Load Pre-Processed Transcript Files

```bash
# Add individual processed transcripts (from data/processed/ only)
python scripts/load-transcript-data.py --add data/processed/processed_episode.json
python scripts/load-transcript-data.py --add data/processed/
```

**Important**: The `--add` command now only accepts processed transcript files (those with proper chunk structure). Raw transcripts will be rejected for safety.

### Method 3: Use Sample Data (for testing)

```bash
npm run seed
```

### Method 4: Direct API Integration

Use the Meilisearch API directly to add documents:

```bash
curl -X POST 'http://localhost:7700/indexes/transcripts/documents' \
  -H 'Authorization: Bearer your-admin-key' \
  -H 'Content-Type: application/json' \
  --data-binary @your-data.json
```

## Future Games

The modular architecture supports easy addition of new games:

- **Guess the Next Word**: Predict podcast conversation flows
- **Quote Attribution**: Match quotes to speakers
- **Episode Timeline Explorer**: Navigate episode moments

Add new game pages in `src/app/games/[game-name]/` following the established patterns.

## API Endpoints

- `GET /api/search?q=query&limit=10&mode=hybrid` - Search transcripts
- `GET /api/quote` - Get daily quote
- `GET /api/random-quote` - Get random quote
- `GET /api/health` - Health check
- `POST /api/transcripts` - Upload transcript data (requires authentication)
- `GET /api/transcripts/list` - List existing transcripts (requires authentication)

### Transcript Upload API

Upload transcript files directly via the API with built-in duplicate detection:

```bash
curl -X POST http://localhost:3001/api/transcripts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -d @transcript.json
```

**Authentication**: Requires the `MEILISEARCH_ADMIN_KEY` in the Authorization header (supports both `Bearer TOKEN` and `TOKEN` formats).

**Request Format**: JSON object with a `documents` array containing transcript chunks:

```json
{
  "documents": [
    {
      "id": "video-123_chunk_0",
      "text": "Transcript text content...",
      "video_id": "video-123",
      "video_title": "Episode Title",
      "original_filename": "episode.txt",
      "start_time": 0,
      "end_time": 30,
      "duration": 30,
      "start_formatted": "00:00:00",
      "end_formatted": "00:00:30",
      "chunk_index": 0,
      "total_chunks": 10,
      "word_count": 45,
      "segment_count": 3,
      "start_minutes": 0,
      "duration_minutes": 0.5,
      "segments": [
        {
          "start": 0,
          "end": 30,
          "text": "Transcript text content..."
        }
      ]
    }
  ]
}
```

**Response Codes**:
- `201`: Transcript uploaded successfully
- `400`: Invalid request (bad JSON, validation errors)
- `401`: Unauthorized (missing/invalid admin key)
- `409`: Conflict (transcript already exists for this video_id)
- `500`: Internal server error

**Duplicate Detection**: Automatically checks if a transcript with the same `video_id` already exists and returns HTTP 409 if found, preventing accidental duplicates.

### Data Management Script

The enhanced Python-based data management script (`scripts/load-transcript-data.py`) provides comprehensive functionality for managing your transcript data with the new optimized workflow:

**Available Commands:**
```bash
# Full automated workflow: download → transcribe → process → upload (local development)
python scripts/load-transcript-data.py --update-sources

# Process locally but upload to production (requires PROD_* env vars)
python scripts/load-transcript-data.py --update-sources --prod

# Clear all data from the search index
python scripts/load-transcript-data.py --clear-index

# Add individual processed transcript files or directories
python scripts/load-transcript-data.py --add data/processed/processed_episode.json
python scripts/load-transcript-data.py --add data/processed/

# Upload to production (requires PROD_* env vars)
python scripts/load-transcript-data.py --add data/processed/ --prod

# Configure semantic search with embeddings
python scripts/load-transcript-data.py --configure-embedder palpal_embedder

# Reset all Meilisearch data (development only)
python scripts/load-transcript-data.py --drop-volume

# Upload only processed files not yet in database
python scripts/load-transcript-data.py --upload-processed

# Clean archive files to remove entries without transcripts (for re-processing)
python scripts/load-transcript-data.py --clean-archives
```

**Production Support:**
The `--prod` flag allows you to process transcripts locally while uploading to production:
- All processing (download, transcribe, optimize) happens locally
- Only the final upload step targets production servers
- Requires production environment variables in your `.env` file

**NEW Directory Structure:**
```
data/
├── download/     # Raw audio files from yt-dlp
├── transcripts/  # Raw JSON transcripts from WhisperX  
└── processed/   # Optimized chunks ready for database upload
```

**Safety Features:**
- Raw transcripts are never uploaded to the database
- Automatic validation ensures only processed transcripts are accepted
- Complete separation of raw data processing and database upload phases

**Advanced Data Management Commands:**

```bash
# Upload Only New Processed Files
python scripts/load-transcript-data.py --upload-processed
```
Scans the `data/processed/` directory and uploads only files that aren't already in the database. Perfect for:
- Incremental updates after processing new transcripts
- Recovery from partial upload failures
- Testing with existing processed files
- Avoiding duplicate uploads

```bash
# Clean Archive Files for Re-processing
python scripts/load-transcript-data.py --clean-archives
```
Removes entries from yt-dlp archive files for videos that don't have corresponding transcripts. This allows you to:
- Re-download and process videos that failed transcription
- Reset download status for incomplete processing
- Clean up after transcript deletions
- Force re-processing of specific videos

**Workflow Examples:**
```bash
# Scenario 1: Incremental processing
python scripts/load-transcript-data.py --update-sources    # Download & process new content
python scripts/load-transcript-data.py --upload-processed  # Upload only new files

# Scenario 2: Recovery from failures
python scripts/load-transcript-data.py --clean-archives    # Reset failed video status
python scripts/load-transcript-data.py --update-sources    # Re-process failed videos

# Scenario 3: Development testing
python scripts/load-transcript-data.py --upload-processed --ignore-errors  # Upload with fault tolerance
```

**Source Configuration:**
Configure your data sources in `scripts/sources.json`:
```json
{
  "download_directory": "./data/download",
  "transcripts_directory": "./data/transcripts", 
  "processed_directory": "./data/processed",
  "error_log_path": "./scripts/update-sources-errors.log",
  "sources": {
    "youtube": [
      {
        "name": "Your Channel Name",
        "url": "https://www.youtube.com/@channel",
        "type": "channel",
        "enabled": true
      }
    ]
  },
  "commands": {
    "yt_dlp": {
      "template": "yt-dlp \"{url}\" --windows-filenames -f ba",
      "description": "Downloads audio files from YouTube"
    },
    "whisperx": {
      "template": "whisperx \"{audio_file}\" --language en --output_dir \"{output_dir}\" --output_format json",
      "description": "Transcribes audio files using WhisperX"
    }
  },
  "settings": {
    "max_concurrent_downloads": 3,
    "max_concurrent_transcriptions": 1,
    "retry_attempts": 2,
    "skip_existing_transcripts": true,
    "verify_api_before_start": true
  }
}
```

The script supports:
- **YouTube Integration**: Download audio files from channels/playlists via yt-dlp
- **WhisperX Integration**: Transcribe audio files to raw JSON transcripts
- **Transcript Processing**: Convert raw transcripts to optimized search chunks using transcript_processor.py
- **Safety Validation**: Only processed transcripts are uploaded - raw data never touches the database
- **Duplicate Prevention**: Skip videos already in your database
- **Error Handling**: Comprehensive logging and error recovery at each stage
- **API Integration**: Uses the authenticated upload endpoint with processed data
- **Concurrent Processing**: Configurable parallelism for downloads and transcription
- **Resume Capability**: Can restart the pipeline at any stage if interrupted

### Standalone Transcript Processing

You can also use the transcript processor independently to convert raw WhisperX JSON files to optimized search format:

```bash
# Process a single raw transcript file
python scripts/transcript_processor.py -i data/transcripts/episode.json -o data/processed/

# Process all files in a directory
python scripts/transcript_processor.py -i data/transcripts/ -o data/processed/
```

**Optimization Features:**
- **75-second chunks** with 15-second overlap for optimal search performance
- **Semantic segmentation** preserving context across chunk boundaries
- **Rich metadata** including timestamps, word counts, and navigation aids
- **Search-optimized format** ready for high-performance Meilisearch indexing

## Troubleshooting

### Common Issues

**"Cannot find embedder" error:**
1. Ensure you've run the load-transcript-data script (it sets up embeddings automatically)
2. Verify embedder configuration matches environment variables

**Port conflicts:**
1. Check if ports 3001 or 7700 are in use
2. Update port numbers in `.env` if needed
3. Restart Docker services: `docker-compose down && docker-compose up -d`

**Search not working:**
1. Verify services are running: `docker-compose ps`
2. Check nginx logs: `docker-compose logs nginx`
3. Test internal connectivity: `docker-compose exec nginx curl http://app:3001/health`
4. Regenerate API keys: `npx tsx scripts/generate-search-key.ts` or `python scripts/generate-search-key.py`

**SSL/HTTPS issues:**
1. Check certificate status: `docker-compose logs certbot`
2. Verify nginx SSL config: `docker-compose exec nginx nginx -t`
3. Test SSL: `curl -I https://your-domain.com`
4. Check certificate expiry: `openssl x509 -in certbot/conf/live/your-domain.com/fullchain.pem -text -noout`

**Connection refused errors:**
1. Ensure only nginx ports (80,443) are exposed externally
2. Check firewall settings on your server
3. Verify DNS points to your server IP
4. Check if services are accessible internally: `docker-compose exec app curl http://localhost:3001`

## Development vs Production

### Development Mode (Default)
For local development, the services run with direct port access:
```bash
# Start development services (with direct port access)
docker-compose up -d

# Access services directly:
# - App: http://localhost:3001
# - Meilisearch: http://localhost:7700
```

### Production Mode (with nginx)
For production deployment with SSL and security:
```bash
# Start with nginx proxy and SSL
docker-compose --profile production up -d

# Or use production override for security hardening:
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Or run SSL setup script:
./scripts/setup-ssl.sh your-domain.com your-email@example.com

# Access via HTTPS only:
# - App: https://your-domain.com
# - All traffic proxied through nginx
```

### Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Generate API keys (Python)
python scripts/generate-search-key.py

# Install Python dependencies
pip install -r data/requirements.txt

# Transcript data management
python scripts/load-transcript-data.py --update-sources    # Full automated workflow (local)
python scripts/load-transcript-data.py --update-sources --prod  # Process local, upload to production
python scripts/load-transcript-data.py --add data/processed/  # Add processed files (local)
python scripts/load-transcript-data.py --add data/processed/ --prod  # Add to production
python scripts/load-transcript-data.py --clear-index       # Clear all data (local)
python scripts/load-transcript-data.py --drop-volume       # Reset all data (development only)
python scripts/load-transcript-data.py --configure-embedder palpal_embedder  # Setup semantic search
python scripts/load-transcript-data.py --upload-processed            # Upload only new processed files
python scripts/load-transcript-data.py --clean-archives              # Clean archives for re-processing

# Process transcripts independently
python scripts/transcript_processor.py -i data/transcripts/ -o data/processed/

# Docker operations
docker-compose up -d          # Start services
docker-compose down           # Stop services
docker-compose logs           # View logs
docker-compose restart       # Restart services
```

## Production Deployment

The application is Docker-ready with multi-stage builds optimized for production. Includes nginx reverse proxy with SSL support for secure HTTPS deployment.

### Quick Production Setup with SSL

1. **Prepare your server:**
   ```bash
   # Clone your repository
   git clone <your-repo>
   cd palpal
   
   # Copy environment file and configure production values
   cp .env.example .env
   # Edit .env with your production settings
   ```

2. **Set up SSL certificates:**
   ```bash
   # Run the automated SSL setup script
   ./scripts/setup-ssl.sh your-domain.com your-email@example.com
   
   # For testing with staging certificates first:
   ./scripts/setup-ssl.sh your-domain.com your-email@example.com --staging
   ```

3. **Deploy:**
   ```bash
   # Start all services with SSL
   docker-compose up -d
   
   # Check logs
   docker-compose logs -f nginx
   ```

### Production Security Features

**Docker Security (docker-compose.prod.yml):**
- **Non-root containers**: Services run as user 999:986 for security
- **Production environment**: NODE_ENV=production and MEILI_ENV=production
- **Network isolation**: Removes localhost port binding for better security

**Nginx Security:**
- **HTTPS Only**: All HTTP traffic redirected to HTTPS
- **Rate Limiting**: API endpoints protected against abuse
- **Security Headers**: XSS protection, content type validation, frame protection
- **SSL**: Modern TLS configuration with strong ciphers
- **Access Control**: Sensitive files blocked from external access

**Usage:**
```bash
# Development (default) - services run as root with direct port access
docker-compose up -d

# Production - services run as non-root user with security hardening
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Copy production environment template
cp .env.prod.example .env
# Edit .env with your production values
```

### SSL Certificate Management

**Automatic Setup:**
- Uses Let's Encrypt for free SSL certificates
- Self-signed certificates for initial setup
- Automatic nginx configuration updates

**Renewal:**
```bash
# Manual renewal
./scripts/renew-ssl.sh

# Set up automatic renewal (add to crontab)
0 3 * * 1 /path/to/palpal/scripts/renew-ssl.sh
```

### Production Checklist

1. **Security:**
   - Generate strong `MEILI_MASTER_KEY`
   - Use production API keys
   - Configure proper CORS origins
   - SSL automatically enabled via nginx

2. **Performance:**
   - Configure persistent volumes for data
   - nginx handles SSL termination and rate limiting
   - Monitor resource usage

3. **Environment:**
   - Set `NODE_ENV=production`
   - Configure proper logging
   - Health checks available at `/health`
   - Plan for data backups

4. **Network Security:**
   - Only ports 80 and 443 exposed externally
   - Internal services (app, meilisearch) only accessible via nginx proxy
   - Rate limiting on API endpoints

### Example Production Configuration

```bash
# .env.production
NODE_ENV=production
APP_PORT=3001
NEXT_PUBLIC_MEILISEARCH_HOST=https://your-meilisearch-host.com
MEILI_MASTER_KEY=your-super-secure-production-key
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com
```

# Getting prod keys
```
  # Create Admin Key
    docker run --rm --network palpal_palpal-network-dev \
    curlimages/curl \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer {masterKey}" \
    -d '{"description":"PALpal Admin key","actions":["*"],"indexes":["*"],"expiresAt":null}' \
    http://meilisearch:7700/keys

  # Create Search Key:
  
      docker run --rm --network palpal_palpal-network-dev \
    curlimages/curl \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer {masterKey}" \
    -d '{"description":"PALpal Admin key","actions":["search"],"indexes":["transcripts"],"expiresAt":null}' \
    http://meilisearch:7700/keys
```