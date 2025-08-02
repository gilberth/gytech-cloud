# Pingvin Share - AI Coding Agent Instructions

## Architecture Overview

Pingvin Share es una plataforma de compartición de archivos self-hosted con arquitectura de 3 capas:

- **Frontend**: Next.js con Mantine UI (`frontend/`)
- **Backend**: NestJS con Prisma ORM (`backend/`)
- **Database**: SQLite por defecto (configurable)

### Servicios principales

- `ShareService`: Gestión de enlaces compartidos con expiraciones y passwords
- `FileService`: Manejo de archivos locales o S3
- `AuthService`: Autenticación JWT, OIDC y LDAP
- `ReverseShareService`: Permite a usuarios externos subir archivos
- `ClamScanService`: Escaneo de malware opcional

## Development Workflow

### Desarrollo Local (Recomendado para nuevas features)

**Setup inicial:**

```bash
# 1. Crear entorno virtual con conda (recomendado)
conda create -n pingvin-share node=22 -y
conda activate pingvin-share

# 2. Instalar dependencias en el entorno
cd backend && npm install
cd ../frontend && npm install

# 3. Setup de base de datos
cd ../backend
npx prisma migrate dev    # Crea DB y ejecuta migraciones
npx prisma db seed        # Datos iniciales

# 4. Desarrollo en paralelo (dentro del entorno)
cd backend && npm run dev     # Backend en puerto 8080
cd frontend && npm run dev    # Frontend en puerto 3000
```

**Workflow de desarrollo local:**

```bash
# IMPORTANTE: Siempre activar el entorno antes de trabajar
conda activate pingvin-share

# Formateo y linting
npm run format              # Formatea frontend y backend
npm run lint               # Linting de ambos proyectos

# Database operations (usar npx para evitar conflictos)
cd backend
npx prisma studio          # UI para inspeccionar DB
npx prisma migrate dev     # Nueva migración
npx prisma generate        # Regenerar cliente tras cambios schema

# Testing completo (dentro del entorno)
cd backend && npm run test:system  # Tests e2e con Newman

# Al terminar la sesión
conda deactivate
```

### Dockerización (Cuando feature está completa)

```bash
# Build local para testing
docker compose -f docker-compose.local.yml up -d

# Con ClamAV para testing de seguridad
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Deploy de imagen de desarrollo
npm run deploy:dev

# Producción (imagen pre-built)
docker compose up -d
```

### Docker Compose patterns:

- `docker-compose.yml`: Producción con imagen pre-built
- `docker-compose.local.yml`: Build local desde código fuente
- `docker-compose.dev.yml`: Servicios adicionales (ClamAV)

### Flujo completo Feature → Docker:

1. **Desarrollo local**: `npm run dev` en backend/frontend por separado
2. **Testing local**: Verificar funcionalidad con hot reload
3. **Database sync**: `npx prisma migrate dev` si hay cambios de schema
4. **Testing dockerizado**: `docker compose -f docker-compose.local.yml up -d`
5. **Deploy**: `npm run deploy:dev` cuando esté listo

### Docker Compose patterns:

- `docker-compose.yml`: Producción con imagen pre-built
- `docker-compose.local.yml`: Build local desde código fuente
- `docker-compose.dev.yml`: Servicios adicionales (ClamAV)

## Patrones específicos del proyecto

### Configuración dinámica

- Configuraciones se almacenan en DB (tabla `Config`)
- `ConfigService` maneja valores con fallback a defaults
- Frontend obtiene config vía `/api/configs` endpoint
- Tipos de config: `string`, `number`, `boolean`, `filesize`, `timespan`

### Autenticación y middleware

- JWT tokens con refresh tokens
- `middleware.ts` (frontend) maneja redirecciones basadas en auth state
- Rutas protegidas por rol: public, authenticated, admin
- Rate limiting con `@nestjs/throttler`

### File handling patterns

- Archivos se almacenan en `SHARE_DIRECTORY` o S3
- Shares se comprimen como ZIP al descargar
- Soporte para proveedores: `local` y `s3`
- Integración ClamAV para escaneo de seguridad

### Database patterns (Prisma)

- Modelos principales: `User`, `Share`, `File`, `ReverseShare`
- Migraciones en `backend/prisma/migrations/`
- Seed data en `backend/prisma/seed/`
- Cascade deletes configurados en relaciones

## Convenciones específicas

### Estructura de módulos NestJS

Cada feature tiene su propio módulo con:

```
feature/
├── feature.module.ts
├── feature.service.ts
├── feature.controller.ts
├── dto/
└── guards/ (si aplica)
```

### Frontend components (Mantine)

- Componentes en `frontend/src/components/`
- Hooks personalizados en `frontend/src/hooks/`
- Servicios API en `frontend/src/services/`
- Tipos compartidos en `frontend/src/types/`

### Manejo de errores

- Backend: Usar excepciones NestJS (`NotFoundException`, `BadRequestException`)
- Frontend: Notificaciones Mantine para errores de API
- Logs estructurados para debugging

## Integrations & External Dependencies

### Authentication providers

- OIDC configurado vía `OAuthModule`
- LDAP support con `ldapts`
- TOTP para 2FA con `otplib`

### File storage providers

- Local filesystem (default)
- AWS S3 con `@aws-sdk/client-s3`
- Configuración dinámica vía config variables

### Email notifications

- Nodemailer para envío de emails
- Templates en `backend/src/email/`
- Configuración SMTP dinámica

## Critical Files for Understanding

- `backend/src/app.module.ts`: Configuración principal de módulos
- `frontend/src/middleware.ts`: Lógica de routing y auth
- `backend/prisma/schema.prisma`: Modelo de datos completo
- `docker-compose.yml`: Setup de producción
- `backend/src/constants.ts`: Constantes del sistema

## Development Notes

- **Entornos virtuales obligatorios**: Usar conda para crear entorno aislado y evitar conflictos de dependencias
- **Local-first development**: Desarrollar nuevas features localmente con hot reload
- **Docker para testing final**: Usar Docker cuando la feature esté completa
- **npx para comandos Node**: Usar npx para ejecutar comandos dentro del entorno virtual
- **Multi-stage Dockerfile**: Frontend y backend se construyen por separado y se combinan
- **Caddy reverse proxy**: Integrado en la imagen, maneja frontend (puerto 3333) y backend (puerto 8080)
- **Volume mounts**: `./data` para archivos y `./data/images` para assets del frontend
- Monorepo con 3 package.json separados (root, frontend, backend)
- Versioning sincronizado entre frontend/backend
- Prisma genera tipos TypeScript automáticamente
- ClamAV es opcional pero recomendado para producción (compose separado)
