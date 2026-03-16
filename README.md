# GYTECH Cloud

Self-hosted file sharing platform and WeTransfer alternative. Built on [Pingvin Share](https://github.com/stonith404/pingvin-share) with significant performance and UX enhancements.

## Features

### Core Sharing
- **Automatic file upload** - Files upload immediately upon selection
- **Direct download URLs** - Friendly URLs with filenames (`/files/{id}/filename.ext`)
- **Smart download logic** - Direct links for single files, ZIP for multiple files
- Unlimited file size (restricted only by disk space)
- Set an expiration date for shares
- Secure shares with visitor limits and passwords
- Email recipients
- Reverse shares

### Upload Performance
- **Parallel chunk uploads** - 5 concurrent chunk uploads per file with 3 files in parallel
- **50MB chunk size** - Optimized for large files (900MB+ tested through tunneled connections)
- **Retry with exponential backoff** - Failed chunks retry individually (3 attempts)
- **Client-driven assembly** - Chunks assembled server-side after all uploads complete
- **Real-time progress** - Byte-level progress tracking with horizontal progress bar and ETA countdown
- **Orphan cleanup** - Hourly cron job removes abandoned upload chunks older than 1 hour
- **Low ZIP compression** - Level 1 compression for ~10x faster share packaging

### User Experience
- **Advanced shares management** - Search, filtering, bulk operations, and status badges
- **Smart file recognition** - Specific icons for PDF, Word, Excel, PowerPoint with extension badges
- **Real image previews** - 40px thumbnails for uploaded images with detailed tooltips
- **Quick Share mode** - One-click sharing with 7-day default expiration
- **Clipboard paste** - Paste images directly with Ctrl+V / Cmd+V
- **Upload ETA** - Estimated time remaining displayed during uploads
- **Rich content previews** - Image galleries and file categorization on share landing pages
- **Mobile-responsive** - Adaptive card layout for mobile file management

### Authentication & Security
- OIDC and LDAP authentication
- Integration with ClamAV for malware scanning
- Password protection and visitor limits
- TOTP two-factor authentication

### Storage
- Local filesystem or S3-compatible storage
- Configurable upload settings and file handling
- Redis cache support (optional)

## Setup

### Docker (recommended)

```bash
# Download docker-compose.yml, then:
docker compose up -d
```

The app is available at `http://localhost:3000`.

### Docker Compose

```yaml
services:
  gytech-cloud:
    image: ghcr.io/gilberth/gytech-cloud:latest
    restart: unless-stopped
    ports:
      - 3000:3000
    environment:
      - TRUST_PROXY=false  # Set to true behind a reverse proxy
    volumes:
      - "./data:/opt/app/backend/data"
      - "./data/images:/opt/app/frontend/public/img"
      # - "./config.yaml:/opt/app/config.yaml"  # Optional: config via file instead of UI
```

### ClamAV Integration

See the [ClamAV setup guide](https://stonith404.github.io/pingvin-share/setup/integrations/#clamav-docker-only) for malware scanning.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS, TypeScript, Prisma ORM, SQLite |
| Frontend | Next.js, TypeScript, Mantine v6 |
| Infrastructure | Docker, Caddy reverse proxy |
| CI/CD | GitHub Actions |

## Development

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev              # Port 8080

# Frontend
cd frontend
npm install
npm run dev              # Port 3000
```

## Configuration

Configuration is managed through the admin UI or a YAML config file. See `config.example.yaml` for available options.

Key upload settings (configurable in admin panel):
- `share.chunkSize` - Upload chunk size (default: 50MB)
- `share.maxSize` - Maximum share size
- `share.shareIdLength` - Length of generated share IDs

## License

Based on [Pingvin Share](https://github.com/stonith404/pingvin-share) by stonith404.
