# MEJORAS ARQUITECTURA BACKEND - GYTECH Cloud

## Análisis Realizado el: 2025-08-07

---

## Mejoras Críticas de Seguridad (Alta Prioridad)

### 1. **JWT Token Storage en Cookies - Alto Riesgo**
**Problema**: Los tokens de acceso se almacenan en cookies regulares sin flag `httpOnly`, vulnerables a ataques XSS.

**Código Actual**:
```typescript
// auth.service.ts:337-341
response.cookie("access_token", accessToken, {
  sameSite: "lax",
  secure: isSecure,
  maxAge: 1000 * 60 * 60 * 24 * 30 * 3, // 3 meses - excesivo!
});
```

**Problemas Identificados**:
- Tokens de acceso accesibles vía JavaScript
- Expiración de 3 meses es excesiva para tokens de 15 minutos
- Sin protección `httpOnly`

**Solución Recomendada**:
```typescript
response.cookie("access_token", accessToken, {
  httpOnly: true,
  sameSite: "lax", 
  secure: isSecure,
  maxAge: 1000 * 60 * 15, // 15 minutos para coincidir con expiración JWT
});
```

### 2. **Inyección de Base de Datos via Campo File Size**
**Problema**: El tamaño del archivo se almacena como `String` en schema Prisma y se parsea con `parseInt()` sin validación.

**Código Problemático**:
```typescript
// share.service.ts:218
size: share.files.reduce((acc, file) => acc + parseInt(file.size), 0)
```

**Recomendación**: Cambiar schema para usar `BigInt` o `Int` con validación adecuada.

### 3. **Rate Limiting Insuficiente**
**Problema**: Rate limit global de 100 requests/minuto es demasiado permisivo para operaciones sensibles.

**Código Actual**:
```typescript
// app.module.ts:31-36
ThrottlerModule.forRoot([{
  ttl: 60,
  limit: 100, // Muy alto para endpoints de autenticación
}])
```

**Recomendación**: Implementar rate limiting específico por endpoint:
- Endpoints de auth: 5 intentos/15 minutos
- Endpoints de upload: 20/minuto por usuario
- Endpoints de download: 50/minuto por share

### 4. **Validación de Entrada Faltante en Nombres de Archivos**
**Problema**: Sin sanitización de nombres de archivos podría llevar a ataques de path traversal.

**Recomendación**: Implementar validación estricta y sanitización de nombres de archivos.

### 5. **Requisitos de Contraseña Débiles**
**Problema**: Sin requisitos de complejidad de contraseña en DTOs o lógica de validación.

**Recomendación**: Implementar políticas de contraseñas fuertes con requisitos mínimos de complejidad.

---

## Mejoras de Rendimiento (Alta Prioridad)

### 1. **Creación Síncrona de ZIP Bloqueando Thread de Request**
**Problema**: `createZip()` en `share.service.ts:109-128` usa operaciones síncronas que bloquean el event loop.

**Código Problemático**:
```typescript
for (const file of files) {
  archive.append(fs.createReadStream(`${path}/${file.id}`), {
    name: file.name,
  });
}
```

**Recomendación**: Mover a sistema de cola asíncrono o procesamiento por streams para evitar bloqueo.

### 2. **Índices de Base de Datos Faltantes**
**Problema**: Sin índices definidos en campos consultados frecuentemente:
- `Share.creatorId`
- `Share.expiration` 
- `File.shareId`
- `RefreshToken.userId`

**Solución Recomendada**:
```prisma
model Share {
  // ... campos existentes
  @@index([creatorId])
  @@index([expiration])
  @@index([uploadLocked])
}
```

### 3. **Problema N+1 en Listado de Shares**
**Problema**: `getSharesByUser()` no usa estrategias de JOIN adecuadas, llevando a múltiples llamadas a base de datos.

**Recomendación**: Optimizar con query única usando includes apropiados.

---

## Problemas Arquitectónicos (Prioridad Media)

### 1. **Manejo de Errores Inconsistente**
**Problema**: Patrones mixtos de manejo de errores en servicios. Algunos lanzan excepciones personalizadas, otros retornan null/undefined.

**Recomendación**: Implementar manejo consistente de errores con filtros de excepción personalizados y respuestas de error estandarizadas.

### 2. **Fallas en Abstracción del Servicio de Storage**
**Problema**: `FileService.getStorageService()` determina storage por operación en lugar de por share, causando inconsistencia.

**Código Problemático**:
```typescript
// Problema: Servicio de storage seleccionado dinámicamente sin consistencia
private getStorageService(storageProvider?: string): S3FileService | LocalFileService
```

**Recomendación**: Almacenar proveedor de storage por share y asegurar consistencia durante todo el ciclo de vida del share.

### 3. **Gestión de Transacciones Faltante**
**Problema**: Operaciones críticas como `complete()` realizan múltiples operaciones de base de datos sin transacciones, arriesgando inconsistencia de datos.

**Recomendación**: Envolver operaciones multi-paso en transacciones de base de datos.

### 4. **Logging y Monitoreo Insuficiente**
**Problema**: Logging estructurado limitado para eventos de seguridad y monitoreo de rendimiento.

**Recomendación**: Implementar logging de auditoría comprehensivo para:
- Intentos de autenticación
- Patrones de acceso a archivos  
- Creación/eliminación de shares
- Cambios de configuración

---

## Problemas de Diseño de Base de Datos (Prioridad Media)

### 1. **Limitaciones de SQLite para Producción**
**Problema**: SQLite no soporta escrituras concurrentes eficientemente y carece de indexado avanzado.

**Recomendación**: Migrar a PostgreSQL para despliegues de producción con connection pooling adecuado.

### 2. **Patrón Soft Delete Faltante**
**Problema**: Eliminaciones hard previenen audit trails y recuperación.

**Recomendación**: Implementar soft delete con timestamps `deletedAt`.

### 3. **Sin Políticas de Retención de Datos**
**Problema**: Shares expirados y tokens se acumulan indefinidamente.

**Recomendación**: Implementar jobs de limpieza para datos expirados.

---

## Preocupaciones de Escalabilidad (Prioridad Baja-Media)

### 1. **Cuello de Botella en Storage de File System**
**Problema**: Storage local de archivos no escalará horizontalmente.

**Recomendación**: Priorizar storage compatible con S3 para despliegues de producción.

### 2. **Estrategia de Caching Faltante**
**Problema**: Sin caching para datos accedidos frecuentemente como configuraciones o metadata de shares.

**Recomendación**: Implementar caching basado en Redis para:
- Valores de configuración
- Metadata de shares
- Sesiones de usuario

### 3. **Arquitectura de Nodo Único**
**Problema**: Sin consideraciones de escalado horizontal.

**Recomendación**: Diseñar para operación stateless con almacenamiento de sesión externo.

---

## Prioridad de Implementación

### **Inmediato (Alta Prioridad)**
1. Arreglar configuraciones de seguridad de cookies JWT
2. Agregar índices de base de datos para rendimiento
3. Implementar rate limiting apropiado por endpoint
4. Agregar validación de entrada para operaciones de archivos

### **Corto Plazo (1-2 semanas)**
1. Implementar gestión de transacciones para operaciones críticas
2. Agregar manejo de errores comprehensivo
3. Implementar logging de auditoría
4. Agregar requisitos de complejidad de contraseñas

### **Mediano Plazo (1-2 meses)**
1. Migrar de SQLite a PostgreSQL
2. Implementar caching con Redis
3. Agregar monitoreo y alertas
4. Implementar políticas de retención de datos

### **Largo Plazo (3-6 meses)**
1. Consideración de arquitectura de microservicios
2. Características avanzadas de seguridad (MFA, SSO)
3. Monitoreo y optimización de rendimiento
4. Arquitectura de escalado horizontal

---

## Conclusión

Este análisis revela un codebase funcionalmente sólido con mejoras significativas de seguridad y escalabilidad necesarias para despliegue de producción. La arquitectura sigue buenos patrones de NestJS pero requiere endurecimiento para uso empresarial.