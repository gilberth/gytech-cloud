# Plan Replanteado de Mejoras Funcionales para GYTECH Cloud (File Sharing Temporal)

Este documento replantea el plan original eliminando los puntos relativos a: (2) Links Directos a Archivos, (4) UI/UX Simplificada y (5) Mejoras de Seguridad, enfocando el roadmap en la evolución funcional, extensibilidad técnica, rendimiento y calidad de la experiencia de vista previa y manejo de archivos. Las áreas excluidas podrán tratarse en un plan separado si se decide retomarlas.

## Objetivo Estratégico

Elevar GYTECH Cloud a una plataforma de transferencia temporal de archivos con:

1. Previsualizaciones avanzadas y enriquecidas multi‑formato.
2. Arquitectura multi‑proveedor de almacenamiento escalable y extensible.
3. Pipeline de ingesta y procesamiento eficiente (chunking, reintentos, colas y procesado diferido).
4. Observabilidad, trazabilidad y calidad operacional (telemetría, métricas, health, auditoría básica no invasiva).
5. Extensibilidad futura (plugins de transformación y análisis de archivos) sin romper el núcleo.

## Principales Áreas de Mejora Funcional

### 1. Vista Previa Avanzada (Alta Prioridad)

- Soporte unificado para: imágenes (PNG, JPEG, WebP, SVG), PDF, video (H.264/MP4, WebM), audio (MP3/OGG), texto plano, markdown, código (syntax highlighting), archivos ofimáticos vía conversión/servicio de terceros (p.e. LibreOffice headless o visor embebido externo).
- Previews progresivas: cargar primero metadata + thumbnail y después contenido completo (streaming para video/audio, range requests para PDF grandes).
- Generación automática de thumbnails (imágenes + frame inicial de video) y extracción de metadata técnica (duración, dimensiones, páginas, bitrate, tipo de codificación) mediante workers.
- Fallback inteligente: descargar archivo si el formato no es soportado para preview.
- Modo accesible (atributos ARIA, contraste, textos alternativos generados a partir de metadata básica).

### 2. Arquitectura Multi‑Storage (Alta Prioridad)

Arquitectura actual: Local + S3. Ampliar a OneDrive, Google Drive y Azure Blob sin acoplar la lógica de negocio.

- Interfaz base refinada `CloudStorageProvider` (upload, download/stream, delete, getUrl (opcional), getMetadata, multipart/resumable support, healthCheck).
- Implementaciones específicas desacopladas y registradas dinámicamente (Strategy + Factory).
- Selección de proveedor por share o por política global (feature flag + config DB).
- Mecanismo de capabilities (qué soporta cada backend: streaming, presigned URLs, server-side encryption, multipart, versioning) para adaptar el flujo.

### 2.1 Estrategia de Fallback y Continuidad Operativa (Nueva)

Objetivo: Permitir cambiar o degradar temporalmente el proveedor primario (OneDrive / Google Drive / Azure Blob / S3) sin interrumpir subidas ni lecturas, aprovechando la base local integrable (filesystem + DB SQLite) como capa de resiliencia.

Problemas a cubrir:

- Caídas del API externo (timeout, throttling, cuotas, credenciales rotadas).
- Latencias elevadas que afectarían TTFP de previews.
- Migraciones progresivas entre proveedores sin ventana de mantenimiento.
- Reprocesamiento / resincronización tras fallo prolongado.

Principios:

1. Write-Ahead Local: Toda subida primero confirma en almacenamiento local (rápido) + metadata en DB antes de intentar el remoto.
2. Async Remote Commit: La sincronización al proveedor primario se hace vía cola (estado transitorio) para no bloquear al usuario.
3. Dual State Tracking: Estados por archivo: LOCAL_PENDING_REMOTE, REMOTE_SYNCED, REMOTE_FAILED, DEGRADING, MIGRATING.
4. Health-Driven Routing: Un "Storage Orchestrator" decide en tiempo real si se sirve desde remoto o copia local según health y freshness.
5. Idempotencia: Hash (MD5/SHA256) y etag almacenados para evitar duplicados al reintentar.
6. Reconciliación Programada: Worker que compara inventarios y reintenta uploads fallidos o limpia artefactos obsoletos.

Extensiones de Modelo (DB):
Tabla nueva `FileStorageLocation`:

- id
- fileId (FK)
- provider (enum: LOCAL, S3, ONEDRIVE, GDRIVE, AZURE_BLOB)
- storedPath
- state (enum: LOCAL_ONLY, SYNCING, SYNCED, FAILED, DEPRECATED)
- checksum (hash)
- sizeBytes
- lastAttemptAt / attempts
- lastSyncAt
- errorCode / errorMessage (opcional)
  Índices: (fileId, provider), (state), (provider, state)

Políticas (configurable por instancia o share):

- SYNC_BLOCKING: Espera confirmación remota (mayor latencia, más consistencia).
- SYNC_ASYNC (por defecto): Devuelve éxito tras persistir local y encolar sincronización.
- PASS_THROUGH: Sólo remoto (sin fallback; no recomendado para misión crítica).
- FALLBACK_ONLY: Mantiene copia local sólo mientras el remoto está en estado unhealthy.

Algoritmo de Upload (SYNC_ASYNC simplificado):

1. Recibir stream -> escribir a almacenamiento local (temp) + calcular hash.
2. Persistir metadata + FileStorageLocation (LOCAL, state=LOCAL_ONLY).
3. Encolar job SYNC_REMOTE(provider, fileId).
4. Responder al cliente (processingState=processing / partial ready para ciertos tipos ex: imágenes pequeñas ya previewable local).
5. Worker ejecuta upload remoto; si OK -> actualizar state a SYNCED, si error -> FAILED y reintento exponencial.

Algoritmo de Lectura:

1. Orchestrator consulta health del provider primario (cache < N segundos) y estado del archivo.
2. Si state remoto = SYNCED y provider healthy -> stream remoto (o presigned redirect si aplica).
3. Si remoto unhealthy o state ≠ SYNCED -> servir copia local (registrar métrica fallback_served_total++).

Health & Circuit Breaker:

- Métricas: remote_latency_p95, remote_error_rate, consecutive_failures.
- Umbrales config: si error_rate > X% o consecutive_failures > Y -> abrir circuito (estado provider=DEGRADED) y forzar fallback.
- Recovery: ventana de pruebas con peticiones canary cada T segundos; si N éxitos consecutivos -> cerrar circuito.

Reconciliación / Migración:

- Proceso MIGRATE(providerA -> providerB): marca target providerB como additional; encola sync para todos los archivos SYNCED en providerA; tras completarse > 99% y verificación hash -> marcar providerA locations como DEPRECATED y opcionalmente eliminar.

Pseudocódigo (TypeScript simplificado):

```ts
async function uploadFile(ctx: UploadCtx) {
  const hash = await streamAndStoreLocal(ctx.stream, ctx.tempPath);
  const meta = await db.file.create({
    data: {
      /* ... */
    },
  });
  await db.fileStorageLocation.create({
    data: {
      fileId: meta.id,
      provider: "LOCAL",
      state: "LOCAL_ONLY",
      checksum: hash,
    },
  });
  queue.add("syncRemote", {
    fileId: meta.id,
    targetProvider: ctx.primaryProvider,
  });
  return { fileId: meta.id, processingState: "processing" };
}

async function syncRemoteJob({ fileId, targetProvider }) {
  const file = await db.file.findUnique(/* ... */);
  const localLoc = await db.fileStorageLocation.findFirst({
    where: { fileId, provider: "LOCAL" },
  });
  try {
    const remotePath = buildRemotePath(file);
    await providers[targetProvider].upload({
      stream: fs.createReadStream(localLoc.path),
      path: remotePath,
      size: file.size,
    });
    await db.fileStorageLocation.upsert({
      /* create or update remote location state=SYNCED */
    });
  } catch (e) {
    await db.fileStorageLocation.update({
      where: { id: localLoc.id },
      data: { state: "LOCAL_ONLY" },
    });
    throw e; // BullMQ reintento
  }
}

async function getDownloadStream(fileId: string) {
  const locs = await db.fileStorageLocation.findMany({ where: { fileId } });
  const remote = locs.find(
    (l) => l.provider !== "LOCAL" && l.state === "SYNCED",
  );
  if (remote && providerHealthy(remote.provider)) {
    return providers[remote.provider].download(remote.storedPath);
  }
  const local = locs.find((l) => l.provider === "LOCAL");
  return fs.createReadStream(local.storedPath);
}
```

Beneficios:

- Cero downtime perceptible durante fallos temporales del proveedor.
- Migraciones progresivas controladas por métrica (se puede pausar si aumenta error rate).
- Métricas claras para capacidad de fallback (ratio fallback vs remote).
- Simplifica rollback: basta con reabrir circuito al local.

Riesgos / Mitigación:

- Consumo de disco local: métricas y políticas de purga para archivos ya SYNCED + LRU si espacio crítico.
- Divergencia de versiones (modificaciones): Modelo de file sharing es append-only (no versiones de edición), reduce riesgo.
- Retrasos en sincronización masiva: Limitar concurrencia y priorizar archivos pequeños para mejorar percepción de disponibilidad.

Métricas Adicionales Propuestas:

- `storage_fallback_served_total{provider="X"}`
- `storage_sync_duration_seconds` (histograma)
- `storage_sync_failures_total{provider="X"}`
- `storage_migration_progress_ratio{from="A",to="B"}`
- `storage_circuit_state{provider="X"}` (0=cerrado,1=abierto)

Checklist de Implementación Incremental:

1. Migración DB `FileStorageLocation`.
2. Orchestrator + provider health pings + circuit breaker simple.
3. Queue job `syncRemote` + reintentos exponenciales.
4. Endpoint lectura adaptativa (sirve remoto o local).
5. Métricas Prometheus + dashboards básicos.
6. Rutina de reconciliación nocturna.
7. Script de migración controlada provider->provider.

Esta sección amplía la Fase 2 (Multi‑Storage) y condiciona la Observabilidad (Fase 3) añadiendo métricas específicas de resiliencia.

### 2.2 Estrategia de Recuperación ante Pérdida de Contenedor (Backups & DR)

Problema específico: Si el contenedor que aloja backend + SQLite/local files se pierde (borrado, corrupción de volumen, accidente en host), garantizar que los archivos y la base de datos puedan restaurarse íntegramente desde al menos un proveedor remoto evitando pérdida de información o ventanas de inoperatividad prolongadas.

Objetivos de Recuperación:

- RPO (Recovery Point Objective): ≤ 5 minutos de datos potencialmente perdidos (target configurable a 1 min cuando BullMQ + WAL shipping estén afinados).
- RTO (Recovery Time Objective): ≤ 10 minutos para poner servicio mínimo (lecturas) y ≤ 20 minutos para restablecer procesamiento completo.

Estrategia General:

1. Desacoplar durabilidad de datos del ciclo de vida del contenedor mediante:
   - Almacenamiento remoto primario (S3 / Blob / Drive / OneDrive) como fuente de verdad para archivos finalizados (estado SYNCED).
   - Replicación incremental de la base de datos (SQLite) mediante snapshots + journal/WAL diferidos a un bucket/carpeta remota.
2. Mantener un MANIFEST de consistencia que enlace (fileId -> checksum, remotePath, metadataVersion) para reconstrucción rápida sin leer toda la DB original.
3. Procedimiento de arranque en frío (Cold Start Recovery) que prioriza disponibilidad de lectura (previews) antes de reindexar metadatos secundarios.

Componentes Técnicos (sin scripts manuales; todo orquestado vía contenedores y API):

- Backup Scheduler: Worker CRON (sidecar docker `dr-scheduler`) que realiza:
  - (Cada N minutos) Flush WAL y genera snapshot comprimido `db-YYYYMMDD-HHMM.sqlite.gz`.
  - Sube snapshot + WAL delta a `remote://backups/db/` con naming atómico (primero `.partial`).
  - Actualiza MANIFEST remoto JSON (`manifest.json`) con hash SHA256 del snapshot y número incremental.
- WAL Shipping Ligero (Opcional): Cada 60s comprimir cambios (diff) y subir `wal-delta-<seq>.bin` para reducir RPO (ejecutado dentro del sidecar, no script externo).
- File Manifest Builder: Tras marcar un archivo como SYNCED se añade entrada al `files-manifest-<epoch>.jsonl` (append-only). Se cierra y rota cada X MB dentro de worker BullMQ/sidecar.
- Integrity Verifier: Job diario que muestrea X% archivos (checksum local vs remoto) y emite métrica de divergencia.

Gestión vía Interfaz Web (Requisito Añadido):

- Toda la orquestación de backups, restauraciones simuladas, verificación de integridad y políticas de retención debe poder administrarse desde la interfaz web (panel admin) sin acceso shell.
- El frontend expondrá un módulo "Resiliencia / Backups" con:
  - Vista de estado: último snapshot, RPO estimado, estado de circuit breaker storage, divergencia última verificación.
  - Tabla de snapshots disponibles (timestamp, tamaño, hash, secuencia, acción: descargar, marcar protegido, iniciar restore simulado).
  - Log de eventos DR (creación snapshot, fallo, restore simulado, limpieza rotación).
  - Configuración editable (intervalo snapshots, retención horas/días/semanas, habilitar WAL delta, porcentaje muestreo integridad).
  - Botón "Ejecutar snapshot ahora" (dispara job inmediato) y "Probar Restore" (lanza simulación en entorno aislado lógico).
- Controles de seguridad mínimos: solo usuarios rol admin.

Backend (Endpoints / Servicios a crear):

- `GET /api/dr/status` -> métricas resumidas (último snapshot, rpoSeconds, snapshotsCount, divergenceRatio, walEnabled, nextPlannedSnapshotAt).
- `GET /api/dr/snapshots` -> listado paginado con metadatos.
- `POST /api/dr/snapshots` -> forzar snapshot inmediato (rate limit interno para evitar spam).
- `POST /api/dr/snapshots/:id/protect` / `DELETE /api/dr/snapshots/:id/protect` -> marcar snapshot como protegido (no rotar).
- `POST /api/dr/restore/simulate` -> dispara job de simulación (NO afecta entorno productivo) y retorna id de operación.
- `GET /api/dr/restore/operations` / `GET /api/dr/restore/operations/:id` -> estado de simulaciones.
- `GET /api/dr/config` / `PUT /api/dr/config` -> CRUD de política (validaciones: limites mínimos/máximos).
- Emisión de eventos internos (NestJS EventEmitter) para notificar al frontend vía SSE o polling (optimización futura websockets optional).

Frontend (Implementación):

- Nuevo feature slice `dr/` con:
  - `services/drApi.ts` (wrapper fetch + tipos TS strict).
  - `components/DrStatusCard.tsx`, `SnapshotsTable.tsx`, `RestoreSimulationModal.tsx`, `ConfigForm.tsx`.
  - `pages/admin/dr/index.tsx` consolidando vistas.
- Manejo de estados con SWR/React Query (si ya existe patrón) para polling de status cada 30s.
- Indicadores visuales: badges (OK, WARN, FAIL) basados en thresholds (e.g. divergencia > 0.5% => FAIL).
- Confirmaciones para operaciones destructivas (eliminar snapshot no protegido).

Modelo / Typescript Types:

```ts
// frontend/src/types/dr.ts
export interface DrStatusDto {
  lastSnapshotAt: string | null;
  rpoSeconds: number | null;
  divergenceRatio: number | null;
  walEnabled: boolean;
  snapshotsCount: number;
  nextPlannedSnapshotAt: string | null;
  circuitStates: Record<string, "CLOSED" | "OPEN" | "DEGRADED">;
}
export interface DrSnapshotDto {
  id: string;
  createdAt: string;
  sizeBytes: number;
  hash: string;
  sequence: number;
  protected: boolean;
  state: "READY" | "PARTIAL" | "VALIDATING";
}
export interface DrConfigDto {
  snapshotIntervalMinutes: number;
  retention: { hourly: number; daily: number; weekly: number };
  walDeltaEnabled: boolean;
  integritySamplePercent: number;
}
```

Autorización:

- Guard NestJS existente para admin; extender claims si es necesario.
- Añadir scopes lógicos (`dr:read`, `dr:write`) para granularidad futura.

Tests Requeridos:

- Unit: servicio de snapshots (rotación, protección, naming atómico).
- Unit: validación de configuración (rechazar intervalos < 1 min o sample > 50%).
- E2E: crear snapshot -> listar -> proteger -> simular restore -> verificar estados.
- Contract: endpoints devuelven campos obligatorios (versionados con `x-api-version` header).

Métricas UI complementarias:

- `dr_ui_actions_total{action="force_snapshot"}`
- `dr_ui_actions_total{action="simulate_restore"}`
- `dr_snapshot_protected_total`

Esto asegura operatividad sin depender de acceso consola y reduce MTTR al facilitar acciones rápidas desde la web.

Formatos:

```
manifest.json {
  "version": 1,
  "latestDbSnapshot": "db-20250808-1530.sqlite.gz",
  "dbHash": "<sha256>",
  "sequence": 182,
  "walDeltas": ["wal-delta-181.bin", "wal-delta-182.bin"],
  "filesManifests": ["files-manifest-20250808-1500.jsonl", "files-manifest-20250808-1530.jsonl"]
}
```

Procedimiento de Restauración (ejecutado por contenedor efímero lanzado vía API; sin scripts shell manuales):

1. API dispara job que monta volumen temporal y descarga `manifest.json`.
2. Descarga snapshot DB + aplica WAL deltas.
3. Reconstruye `FileStorageLocation` si falta usando manifiestos.
4. Verifica integridad (hash) y guarda resultado.
5. Servicio temporal expone endpoints read-only para validación.
6. Al aprobarse en UI, operación real (futuro) reemplaza volumen principal bajo bloqueo.

Optimización para Migración a Postgres (Evolución):

- Camino opcional: migrar a Postgres gestionado (RDS / Azure PG / AlloyDB) reduciendo complejidad de snapshots manuales. El plan mantiene SQLite inicialmente por simplicidad; se documenta ADR para futura externalización.

Métricas Adicionales DR:

- `backup_last_snapshot_timestamp`
- `backup_db_snapshot_duration_seconds`
- `backup_db_snapshot_failures_total`
- `dr_restore_simulation_duration_seconds`
- `integrity_divergence_ratio` (archivos divergentes / muestreados)

Alertas (umbral sugerido):

- Divergencia > 0.5% en verificación diaria.
- Último snapshot > 2 \* intervalo configurado.
- Fallos consecutivos de snapshot > 3.

Flujo de Estados para DB Snapshot:

1. GENERATING → UPLOADING_PARTIAL → VALIDATING_REMOTE_HASH → READY.

Cambios en Roadmap (Fase Sugerida):

- Insertar subtarea en Fase 2: Implementar Backup Scheduler + snapshot básico.
- Fase 3: Añadir Integrity Verifier + métricas y pruebas de restauración simulada (chaos test mensual).

Checklist Implementación DR (dockerizado / API driven):

1. Sidecar `dr-scheduler` (flush WAL, compresión, hash, subida atómica + manifest update).
2. Endpoints para forzar snapshot -> encolan tarea en scheduler.
3. Generación de `files-manifest` en worker (on SYNCED) sin scripts.
4. Job de simulación de restore en contenedor efímero controlado por backend.
5. Métricas y alertas Prometheus + reglas.
6. Test automatizado de simulación: volumen aislado, ejecutar restore, comparar counts.
7. Documentar RPO/RTO y mejoras (ADR).

Riesgos / Mitigación:

- Corrupción simultánea manifest + snapshot: mantener retención de las últimas K versiones + verificación de hashes antes de rotar.
- Coste almacenamiento de snapshots: política de retención (ej: últimos 7 días cada hora + 30 días diarios + 90 días semanales).
- Ventana de inconsistencia si se pierde container justo antes de subir snapshot: mitigar con WAL delta frecuente.

Conclusión: Esta capa garantiza que la pérdida del contenedor no implica pérdida de archivos (remotos ya SYNCED) ni de metadatos críticos más allá del RPO definido, alineada con objetivos de resiliencia, eliminando scripts manuales y favoreciendo un flujo 100% dockerizado (entorno local de desarrollo reutiliza mismos servicios).

### 3. Pipeline de Ingesta, Procesamiento y Enriquecimiento (Media/Alta Prioridad)

- Subidas chunked/resumables (posible adopción de TUS o capa propia con identificador de sesión y consolidación).
- Cola de trabajos (Bull / BullMQ) para: generación de thumbnails, extracción de metadata, transcodificación ligera opcional (primer frame video, normalización imágenes grandes).
- Reintentos con backoff y etiquetado de estado (pending, processing, ready, failed, expired).
- Limpieza programada de artefactos temporales (thumbnails huérfanos, chunks incompletos, archivos fallidos).
- Métricas de throughput y tiempos medios (upload -> ready).

### 4. Observabilidad y Calidad Operacional (Media Prioridad)

- Métricas (Prometheus/OpenMetrics) para: tamaño medio archivos, volumen diario, latencia preview, ratio fallos procesado, tiempo de generación de thumbnails.
- Logging estructurado (correlation id por share / file) y niveles (info/warn/error) con redacción de datos sensibles.
- Health checks profundos: conectividad a cada storage, espacio disponible local, backlog de colas.
- Trazas distribuidas (OpenTelemetry) mínimas en puntos críticos (upload, storage put, preview fetch).

### 5. Extensibilidad y Plugins de Procesamiento (Media Prioridad)

- Diseño de un contenedor de "file processors" con interfaz única (accept(file) -> boolean, process(context) -> enrichedMetadata).
- Procesadores iniciales: metadata multimedia, thumbnail, syntax highlight (generar AST/metadata de lenguaje), normalizador de imágenes (limitar dimensiones, compresión).
- Registro dinámico vía configuración (enable/disable por tipo de archivo o por política de instancia).

### 6. Gestión de Vida Útil y Limpieza (Media Prioridad)

Aunque no se profundiza en seguridad avanzada, se mantiene la noción de temporalidad funcional:

- TTL configurable a nivel share (persistido en DB) y job de expiración que marca archivos y programa eliminación física segura.
- Estado intermedio "expiring" para permitir monitoreo y métricas de rotación.

## Fases de Implementación Propuestas

### Fase 1 (2-3 semanas) – Núcleo de Preview y Metadata

1. Refactor interfaz `CloudStorageProvider` mínima (sin proveedores nuevos aún).
2. Implementación de pipeline de thumbnails + metadata para imágenes y PDFs.
3. Componente backend de preview (endpoint `GET /api/shares/:shareId/files/:fileId/preview` devolviendo contenido o stream).
4. Componente frontend `FilePreview` multi-formato básico (imagen, pdf inline, texto plano, código con highlight).
5. Modelo `FileMetadata` y migración inicial.

### Fase 2 (3-4 semanas) – Multi‑Storage & Pipeline Avanzado

1. Implementaciones OneDrive, Google Drive, Azure Blob.
2. Factory + capabilities registry.
3. Subidas chunked/resumables (fase 1: diseño + endpoints; fase 2: integración con providers que soportan multipart).
4. Cola de procesado (BullMQ) + workers para thumbnails/video frame.
5. Métricas básicas (tiempo de ingesta, fallos de procesado, storage distribution).

### Fase 3 (2 semanas) – Observabilidad & Extensibilidad

1. OpenTelemetry + Prometheus exporter.
2. Health checks profundos (storage, queue, disk usage).
3. Procesadores plugin: metadata multimedia avanzada, syntax highlight, normalizador imágenes.
4. Expiración y limpieza programada (cron jobs) con estados intermedios.

### Fase 4 (1-2 semanas) – Optimización y Pulido Técnico

1. Streaming optimizado (range requests video/pdf).
2. Cache de thumbnails y metadata (in-memory + TTL + invalidación en delete).
3. Reducción de cold start preview (precálculo eager en subida completada).
4. Documentación técnica (ADR para multi-storage & processors) y pruebas de carga.

## Cambios Técnicos Principales

### Backend

- Interfaz extendida `CloudStorageProvider` + registry.
- Workers de procesado (cola) y esquema de reintentos.
- Endpoints de preview, metadata y estado de procesado.
- Módulo de expiración y limpieza.
- Integración OpenTelemetry + métricas.

### Frontend

- Componente `FilePreview` con estrategia de render adaptativa.
- Indicadores de estado (procesando, listo, falló) sobre la lista de archivos compartidos.
- Vista de detalle mostrando metadata enriquecida.
- Carga progresiva: primero lista y thumbnails, luego previews completas.

### Base de Datos

- Tabla `FileMetadata` (fileId FK, mimeType, sizeBytes, width, height, durationMs, pages, hash, processingState, error, extra JSONB-like serializado, createdAt/updatedAt).
- Campos en share para: `storageProvider`, `ttlSeconds`, `expiresAt`.
- Índices: (processingState), (expiresAt), (storageProvider) para filtrado operativo.

## Especificación Técnica de la Interfaz (Borrador)

```typescript
interface CloudStorageProvider {
  readonly name: string;
  capabilities: {
    streaming?: boolean;
    multipart?: boolean;
    presignedUrls?: boolean;
    nativeMetadata?: boolean;
  };
  upload(params: {
    stream: NodeJS.ReadableStream;
    path: string;
    size?: number;
    contentType?: string;
    checksum?: string;
  }): Promise<{ storedPath: string; etag?: string }>;
  download(
    path: string,
    options?: { range?: { start: number; end?: number } },
  ): Promise<NodeJS.ReadableStream>;
  delete(path: string): Promise<void>;
  getUrl?(
    path: string,
    opts?: { expiresInSeconds?: number; inline?: boolean },
  ): Promise<string>;
  getMetadata(path: string): Promise<{
    size: number;
    contentType?: string;
    lastModified?: Date;
    etag?: string;
  }>;
  multipartInit?(
    path: string,
    size?: number,
    contentType?: string,
  ): Promise<{ uploadId: string }>;
  multipartUploadPart?(
    uploadId: string,
    partNumber: number,
    data: Buffer | NodeJS.ReadableStream,
  ): Promise<{ etag: string }>;
  multipartComplete?(
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<{ storedPath: string }>;
  healthCheck(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
```

## Métricas de Éxito (Replanteadas)

- Preview TTFP (time-to-first-paint) < 900ms para imágenes < 5MB.
- Latencia P95 de generación de thumbnail < 3s tras finalizar upload.
- Tasa de éxito de procesado > 99% (excluyendo formatos no soportados).
- Tiempo medio upload -> ready < 15s en archivos de hasta 500MB (sin transcodificación pesada).
- Soporte operativo estable para ≥ 5 proveedores (Local, S3, OneDrive, GDrive, Azure Blob) con health checks pasando > 99%.
- Cobertura de tests del dominio crítico (storage + processing + preview) ≥ 80% líneas.

## Riesgos y Mitigaciones

- Complejidad multi-storage: Mitigar con capa de capabilities y tests contractuales por provider.
- Costo de procesado multimedia: Limitar transcodificación a tareas ligeras + colas con límite de concurrencia.
- Crecimiento de metadata/thumbnails: Políticas de expiración y limpieza + tamaños máximos de thumbnail.
- Bloqueos en cola: Supervisión de métricas de lag + alertas.

## Exclusiones Explícitas de Este Plan

- Links directos públicos individualizados (se posponen).
- Rediseño completo UI estilo WeTransfer (fuera de alcance actual).
- Medidas de seguridad avanzadas (tokens únicos por archivo, password protection, rate limiting específico) – se mantienen sólo controles mínimos existentes.

## Next Steps (Acciones Inmediatas)

1. Crear migración `FileMetadata` y campos de expiración en `Share`.
2. Escribir contrato de pruebas para `CloudStorageProvider` (interfaz + test harness).
3. Implementar thumbnails imágenes (PNG/JPEG) en worker.
4. Endpoint preview básico (imágenes + texto + pdf stream).
5. Añadir métricas iniciales: contador de uploads, histogram de tamaño, gauge de cola.

---

_Plan replanteado el: 2025-08-08_
