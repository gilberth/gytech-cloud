# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GYTECH Cloud is a self-hosted file sharing platform and WeTransfer alternative. It's a full-stack application with:

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

### Frontend Architecture

- **Framework**: Next.js with file-based routing
- **UI**: Mantine v6 components with custom theming
- **State**: React hooks with custom services for API calls
- **i18n**: React Intl with translation files in `src/i18n/translations/`

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
- `docker-compose.yml` - Production with pre-built image
- `docker-compose.local.yml` - Local build from source code
- `docker-compose.dev.yml` - Additional services (ClamAV)

### Complete Feature → Docker Workflow
1. **Local development**: Separate `npm run dev` for backend/frontend
2. **Local testing**: Verify functionality with hot reload
3. **Database sync**: `npx prisma migrate dev` if schema changes
4. **Docker testing**: `docker compose -f docker-compose.local.yml up -d`
5. **Deploy**: `npm run deploy:dev` when ready

### Docker Commands
```bash
# Local build for testing
docker compose -f docker-compose.local.yml up -d

# With ClamAV for security testing
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Production (pre-built image)
docker compose up -d
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