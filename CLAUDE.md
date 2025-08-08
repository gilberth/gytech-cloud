# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GYTECH Cloud (based on Pingvin Share) is a self-hosted file sharing platform and WeTransfer alternative. It's a full-stack application with:

- **Backend**: NestJS with TypeScript, Prisma ORM, SQLite database
- **Frontend**: Next.js with TypeScript, Mantine UI components
- **Documentation**: Docusaurus
- **Infrastructure**: Docker containers with Docker Compose

## Architecture

The codebase follows a monorepo structure with separate applications:

- `backend/` - NestJS API server with modules for auth, shares, users, config, files, OAuth, etc.
- `frontend/` - Next.js web application with pages, components, hooks, and services
- `docs/` - Docusaurus documentation site
- `scripts/` - Utility scripts for configuration generation

### Backend Architecture

- **Database**: Prisma ORM with SQLite (see `backend/prisma/schema.prisma`)
- **Authentication**: JWT tokens, TOTP 2FA, OAuth (Discord, GitHub, Google, Microsoft), LDAP
- **File Storage**: Local filesystem or AWS S3
- **Security**: ClamAV integration for malware scanning, rate limiting
- **Core Modules**: Auth, Share, ReverseShare, User, Config, File, OAuth
- **Testing**: Newman (Postman) system tests in `test/newman-system-tests.json`

### Frontend Architecture

- **Framework**: Next.js with file-based routing
- **UI**: Mantine v6 components with custom theming
- **State**: React hooks with custom services for API calls
- **i18n**: React Intl with translation files in `src/i18n/translations/`
- **Translation Pattern**: Use `FormattedMessage` for components, `t()` hook for dynamic content
- **Modal Translations**: `translateOutsideContext()` for modals rendered outside React tree

## Development Workflow

### Recommended Local Development Setup

```bash
# 1. Create conda virtual environment (REQUIRED)
conda create -n pingvin-share node=22 -y
conda activate pingvin-share

# 2. Install dependencies in isolated environment
cd backend && npm install
cd ../frontend && npm install

# 3. Database setup
cd ../backend
npx prisma migrate dev    # Creates DB and runs migrations
npx prisma db seed        # Initial data

# 4. Parallel development (within environment)
cd backend && npm run dev     # Backend on port 8080
cd frontend && npm run dev    # Frontend on port 3000
```

### Daily Development Commands

```bash
# ALWAYS activate environment first
conda activate pingvin-share

# Root level
npm run format              # Format frontend and backend
npm run lint               # Lint both projects
npm run deploy:dev         # Deploy development image

# Backend (use npx to avoid conflicts)
cd backend
npx prisma studio          # Database UI
npx prisma migrate dev     # New migration
npx prisma generate        # Regenerate client after schema changes
npm run test:system        # E2E tests with Newman

# Frontend
cd frontend
npm run dev               # Development server
npm run build            # Production build

# When done
conda deactivate
```

## Database Management

- **Migrations**: Located in `backend/prisma/migrations/`
- **Schema**: `backend/prisma/schema.prisma`
- **Seeding**: `backend/prisma/seed/config.seed.ts`
- **Commands**: Use `prisma migrate` and `prisma db seed` in backend directory

## Docker Development

### Docker Compose Patterns

- `docker-compose.yml` - Production with pre-built image (uses `ghcr.io/gilberth/gytech-cloud:latest`)
- Additional compose files for development and services may need to be created locally
- ClamAV integration available as documented extension

### Complete Feature → Docker Workflow

1. **Local development**: Separate `npm run dev` for backend/frontend
2. **Local testing**: Verify functionality with hot reload
3. **Database sync**: `npx prisma migrate dev` if schema changes
4. **Docker testing**: Create local compose file if needed
5. **Deploy**: `npm run deploy:dev` builds and pushes development image

### Docker Commands

```bash
# Production (pre-built image)
docker compose up -d

# Deploy development image (requires appropriate Docker registry access)
npm run deploy:dev
```

## Configuration

- Configuration managed through UI or YAML file
- Example config: `config.example.yaml`
- Environment variables for database URL, trust proxy settings

## Critical Architectural Patterns

### Authentication & Security Flow

- **Dual Token System**: Access tokens (short-lived) + refresh tokens with automatic renewal
- **Guard Chain Pattern**: `JwtGuard` → `ShareSecurityGuard` → `FileSecurityGuard` extending functionality
- **Share-specific JWT**: Individual tokens per share with expiration matching share lifecycle
- **TOTP Flow**: LoginToken intermediary when `user.totpVerified` is true (`backend/src/auth/strategy/jwt.strategy.ts`)

### Share & File Management

- **Chunked Upload**: Default 10MB chunks via `uploadFile()` in share service
- **Storage Abstraction**: `FileService` facade choosing Local/S3 based on config
- **Share Lifecycle**: Create → Upload → Complete → Async ZIP creation
- **Reverse Shares**: Pre-configured templates with usage tracking and token access
- **Quick Share Mode**: Automatic upload with default settings for rapid sharing
- **File Type Recognition**: Granular document type detection (PDF, Word, Excel, PowerPoint)
- **Visual Enhancement**: Extension badges, tooltips, and type-specific icons for UX

### Database Relationships (Critical)

```
User → Share (optional creator, allows anonymous)
Share → File[] (cascade delete)
Share → ShareSecurity (optional, one-to-one)
User → RefreshToken[] (cascade delete)
ReverseShare → Share[] (many reverse shares create regular shares)
```

### Configuration Management

- **Dual System**: YAML file (locks UI) OR database config (UI editable)
- **Event-driven**: Config service emits updates on changes
- **Categories**: `general`, `share`, `email`, `oauth`, `s3`, etc. with typed retrieval
- **Config Types**: `string`, `number`, `boolean`, `filesize`, `timespan`
- **Dynamic Loading**: Frontend gets config via `/api/configs` endpoint

### Frontend Patterns

- **Service Layer**: Axios-based with cookie management in `frontend/src/services/`
- **Context Pattern**: `UserContext`/`ConfigContext` for global state
- **Modal Functions**: Return modal configs (`showCreateUploadModal()`)
- **Middleware Routing**: Complex protection logic in `frontend/src/middleware.ts`
- **Modal Components**: Separate components for complex modals (e.g., `ShareEditModal`) with form validation
- **Search & Filtering**: Debounced search with real-time filtering patterns
- **Bulk Operations**: Multi-select state management with Set-based selection tracking
- **Responsive Design**: Mobile-first with `useMediaQuery` hook for adaptive layouts

## Testing Strategy

- **System Tests Only**: Newman (Postman) API tests via `npm run test:system`
- **Database Reset**: `prisma migrate reset -f` before system tests
- **Test Flow**: Start server → Wait for health → Run Newman tests

## Project-Specific Conventions

### NestJS Module Structure

Each feature follows this pattern:

```
feature/
├── feature.module.ts
├── feature.service.ts
├── feature.controller.ts
├── dto/
└── guards/ (if applicable)
```

### File Storage & Security

- Files stored in `SHARE_DIRECTORY` or S3
- Shares compressed as ZIP for download
- Storage providers: `local` and `s3`
- ClamAV integration for malware scanning
- File handling via `FileService` abstraction layer

### Error Handling Patterns

- **Backend**: NestJS exceptions (`NotFoundException`, `BadRequestException`)
- **Frontend**: Mantine notifications for API errors
- **Logging**: Structured logs for debugging

### External Integrations

- **OIDC/LDAP**: Configured via `OAuthModule` and `ldapts`
- **TOTP 2FA**: Using `otplib` library
- **Email**: Nodemailer with dynamic SMTP configuration
- **S3**: AWS SDK v3 for cloud storage

## Critical Files for Understanding

- `backend/src/app.module.ts` - Main module configuration
- `frontend/src/middleware.ts` - Routing and auth logic
- `backend/prisma/schema.prisma` - Complete data model
- `backend/src/constants.ts` - System constants
- `docker-compose.yml` - Production setup with Caddy reverse proxy

## Key File Locations

- Main backend entry: `backend/src/main.ts`
- Frontend pages: `frontend/src/pages/`
- API routes: Backend modules in `backend/src/`
- Components: `frontend/src/components/`
- Database models: `backend/prisma/schema.prisma`
- Frontend API proxy: `frontend/src/pages/api/[...all].tsx` (proxies to backend in development)
- Configuration example: `config.example.yaml`
- Translation files: `frontend/src/i18n/translations/`

## Recent UX Architecture Enhancements

### Advanced Shares Management (`frontend/src/pages/account/shares.tsx`)

- **Search Implementation**: Real-time filtering with `useDebouncedValue` (300ms)
- **Status Management**: Badge system for share states (Active, Expired, Expiring, View Limit)
- **Bulk Operations**: Set-based selection tracking with confirmation modals
- **Responsive Design**: Conditional rendering between table (desktop) and cards (mobile)

### Enhanced File Recognition System

- **Type Detection**: Granular file type identification with color-coded icons
- **Visual Elements**: Extension badges positioned absolutely over thumbnails
- **Tooltip Integration**: Rich file information with type descriptions and sizes
- **Icon Mapping**: Specific icons for document types (PDF, Word, Excel, PowerPoint)

### Modal Component Architecture

- **Separation of Concerns**: Modal functions (`show*Modal`) vs. components (`*Modal`)
- **Form Validation**: Mantine `useForm` with custom validation rules
- **State Management**: Local loading states with async operations
- **Translation Integration**: `translateOutsideContext()` for modals outside React tree

### Quick Share Implementation

- **Default Configuration**: Intelligent defaults bypass modal for rapid sharing
- **Workflow Optimization**: Reduces sharing time from 2 minutes to 30 seconds
- **Smart Expiration**: 7-day default for quick shares, configurable for manual shares

## Important Development Reminders

- **Environment Isolation**: Always use conda virtual environment for Node.js development
- **Database Commands**: Use `npx` prefix for all Prisma commands to avoid version conflicts
- **Local-First Development**: Develop features locally before containerizing
- **Translation Requirements**: All user-facing text must use the i18n system, no hardcoded strings
- **Modal Patterns**: Complex modals should be separate components, not inline functions
- **File Type Detection**: Use granular type detection for better UX (PDF vs generic document)
- **Responsive Design**: Test both desktop table and mobile card layouts
- **Search Performance**: Use debounced search (300ms) for real-time filtering

## Rebranding Status

**Project Name**: GYTECH Cloud (based on Pingvin Share)

**Pending Frontend Updates** (non-urgent):

- Update GitHub links in homepage (`frontend/src/pages/index.tsx:169`)
- Update admin panel links (`frontend/src/pages/admin/index.tsx:67`, `frontend/src/pages/admin/intro.tsx:30`)
- Update package.json references to reflect new branding
- Consider updating default configuration values (appName, etc.)

## Development Troubleshooting

- **Port Management**:

  - Backend default: port 8080
  - Frontend default: port 3000
  - Kill processes if ports are occupied: `pkill -f "nest start"` or `pkill -f "next dev"`
  - Frontend proxy configuration automatically routes `/api/*` to backend

- **Database Issues**:
  - Reset database: `npx prisma migrate reset -f`
  - View database: `npx prisma studio`
  - Always run Prisma commands from `backend/` directory

## Frontend Monitoring Recommendations

- **Frontend Health Monitoring**:
  - Luego de iniciar el frontend esperar cierto tiempo para validar si aun se encuentra activo, si no revisa el motivo de la caida del front

Cada cambio que realice agregaro a CHANGELOG.md