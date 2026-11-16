# Tasks API

Una API de tareas pequeña, con decisiones explícitas y fácil de revisar. Express 5, TypeScript estricto y SQLite. Sin Docker, ORM ni servicios externos.

## Ejecutar

Requisitos: **Node.js 24.x** y **pnpm 12.21.0**.

```sh
pnpm install --frozen-lockfile
pnpm setup:env
pnpm migrate
pnpm dev
```

`setup:env` crea `.env` con una clave aleatoria de 256 bits y permisos de lectura/escritura solo para su propietario. No imprime la clave, no modifica archivos existentes y `.env` está excluido de Git. Si ya tienes un `.env`, añade `API_TOKEN` con una clave generada con `node -p "require('node:crypto').randomBytes(32).toString('hex')"`.

La API escucha en `http://127.0.0.1:3000/api/tasks`. La base persiste en `data/tasks.sqlite`. Ejecuta los comandos desde la raíz del proyecto. El servidor no arranca sin una clave configurada con el formato requerido.

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `API_TOKEN` | Sin valor por defecto; obligatoria | Clave privada de 64 caracteres hexadecimales minúsculos |
| `PORT` | `3000` | Puerto entre 1 y 65535 |
| `HOST` | `127.0.0.1` | Interfaz de escucha |
| `DATABASE_PATH` | `./data/tasks.sqlite` | Archivo SQLite |
| `REQUESTS_PER_MINUTE` | `300` | Máximo global por instancia, entre 1 y 10000 |
| `MAX_TASKS` | `10000` | Máximo de tareas almacenadas, entre 1 y 100000 |

```sh
pnpm check           # tipos + todos los tests + compilación
pnpm security:check  # auditoría de dependencias, incluidas las de desarrollo; necesita red
pnpm build
pnpm start           # ejecuta dist/server.js; requiere migrar antes
```

`node:sqlite` puede emitir un aviso experimental según la versión de Node 24. El cierre por SIGINT/SIGTERM deja de aceptar peticiones, espera las activas y cierra la base.

## Acceso y contrato HTTP

Todas las rutas requieren `Authorization: Bearer <API_TOKEN>`. La clave representa a un cliente de confianza con permiso para gestionar **todas** las tareas; `assignee` es un dato de negocio, no una identidad autenticada. No se aceptan claves por URL ni cookies. Para revocar o rotar la clave, sustituye `API_TOKEN` en `.env` y reinicia el servidor: la clave anterior deja de ser válida.

Los siguientes resultados presuponen una credencial válida:

| Método | Ruta | Resultado |
| --- | --- | --- |
| POST | `/api/tasks` | Crea una tarea: 201 y cabecera Location |
| GET | `/api/tasks` | Lista filtrada y paginada: 200 |
| GET | `/api/tasks/:id` | Consulta: 200 o 404 |
| PATCH | `/api/tasks/:id` | Edita los campos enviados: 200 o 404 |
| DELETE | `/api/tasks/:id` | Borra: 204 sin cuerpo o 404 |

POST y PATCH requieren `Content-Type: application/json`. Los cuerpos comprimidos se rechazan con 415; no hay necesidad de descomprimir cuerpos de tareas de hasta 32 KB.

Carga la clave en tu terminal sin copiarla al historial:

```sh
export API_TOKEN="$(node --env-file=.env -p 'process.env.API_TOKEN')"

curl -i http://127.0.0.1:3000/api/tasks \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Preparar entrega","description":"Revisar los tests","assignee":"Ana","dueDate":"2026-12-10"}'

curl 'http://127.0.0.1:3000/api/tasks?status=pendiente&assignee=Ana&page=1&limit=10' \
  -H "Authorization: Bearer $API_TOKEN"

curl -X PATCH http://127.0.0.1:3000/api/tasks/1 \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"hecha"}'

curl -i -X DELETE http://127.0.0.1:3000/api/tasks/1 \
  -H "Authorization: Bearer $API_TOKEN"
```

| Campo | Regla |
| --- | --- |
| `title` | Obligatorio, 1–200 caracteres tras quitar espacios exteriores |
| `description` | Obligatoria, permite cadena vacía, máximo 5000 caracteres |
| `status` | `pendiente`, `en_curso` o `hecha`; por defecto `pendiente` al crear |
| `assignee` | Obligatorio, 1–100 caracteres; nombre, sin catálogo de usuarios |
| `dueDate` | Fecha real `YYYY-MM-DD`; permite fechas vencidas |

La respuesta añade `id`, `createdAt` y `updatedAt` (timestamps UTC). PATCH exige al menos un campo. Se rechazan campos desconocidos, valores `null` y caracteres nulos (`\u0000`) en título, descripción y responsable. Se puede reabrir una tarea hecha.

Filtros `status` y `assignee` combinados con AND. Responsable por coincidencia exacta, sensible a mayúsculas. `page` por defecto 1 (máximo 1 000 000); `limit` por defecto 20 (máximo 100). Solo enteros positivos. Orden por ID ascendente. Parámetros desconocidos o repetidos producen 400.

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

`total` cuenta las tareas que cumplen los filtros. Una página fuera de rango devuelve una lista vacía con 200. El total y los elementos se consultan en la misma transacción de lectura.

Errores de la aplicación con `Content-Type: application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Datos inválidos.",
  "status": 422,
  "instance": "/api/tasks",
  "errors": [{ "field": "title", "message": "..." }]
}
```

| Código | Motivo |
| --- | --- |
| 400 | JSON, URL, ID o query inválidos |
| 401 | Credencial ausente o inválida; incluye `WWW-Authenticate` |
| 404 | Ruta o tarea inexistente |
| 409 | Cuota de tareas alcanzada; borrar alguna permite volver a crear |
| 413 | Cuerpo mayor de 32 KB |
| 415 | Formato o compresión no soportados |
| 422 | Datos de una tarea inválidos |
| 429 | Límite global de peticiones alcanzado; incluye `Retry-After` |
| 500 | Error inesperado, sin detalles internos en la respuesta |
| 503 | SQLite ocupada por otra conexión; incluye `Retry-After: 1` |

El servidor HTTP limita cabeceras a 8 KB, recepción de cabeceras a 10 segundos, recepción de peticiones a 15 segundos y keep-alive a 5 segundos. Los rechazos del parser HTTP de Node (por ejemplo, 431 por cabeceras excesivas) ocurren antes de Express y no usan el formato JSON de la aplicación.

## Seguridad y límites operativos

- SQL parametrizado en creación, lectura, edición, borrado y filtros. Los nombres de columnas del PATCH salen de un mapa cerrado; no se interpolan valores del cliente en SQL.
- Autenticación antes de parsear el cuerpo, comparación de hashes de longitud fija con `timingSafeEqual`, rechazo de cabeceras Authorization duplicadas y ausencia de claves predeterminadas.
- Cabeceras `nosniff`, `Cache-Control: no-store`, CSP restrictiva y `Referrer-Policy: no-referrer`.
- Límite global de peticiones por instancia, incluidas las no autenticadas. Usa un único contador en memoria: no crece con IPs ni confía en `X-Forwarded-For`. Se reinicia al reiniciar el proceso y todos los clientes comparten la cuota. No sustituye la protección de tráfico en el proxy ni garantiza disponibilidad frente a ataques distribuidos.
- Cuota de tareas comprobada dentro del mismo INSERT para evitar carreras entre conexiones. Persiste con los datos; no es un límite exacto del tamaño del archivo SQLite.
- Sin descompresión de cuerpos. Express, Zod y dependencias transitivas actualizados; CI ejecuta `pnpm security:check` y falla ante cualquier aviso conocido.

El destino por defecto sigue siendo local. Para acceso remoto, terminar **HTTPS** en un proxy, mantener la API en una red privada y restringir tráfico en ese proxy. La aplicación no implementa TLS por sí misma. No activar `trust proxy` indiscriminadamente. Una clave compartida no proporciona aislamiento entre usuarios: para ese requisito se necesita un modelo de usuarios y autorización por recurso.

## Pruebas y verificación

**32 tests**: 14 de API HTTP, 7 de controles de seguridad y configuración, y 11 de persistencia, migraciones y validación. Cubren CRUD, filtros, SQL malicioso, campos protegidos, contaminación del prototipo, caracteres nulos, URLs inválidas, cuerpos comprimidos, autenticación, límites, cuota, bloqueos, recuperación y migración de bases existentes.

Verificado con Node 24.18.0 y pnpm 12.21.0:

- `pnpm check`: correcto; pasan los 32 tests, el chequeo de tipos y la compilación.
- `pnpm security:check`: cero vulnerabilidades conocidas, incluidas dependencias de desarrollo.
- Migraciones repetibles y actualización sin pérdida de tareas verificadas con bases aisladas.

La primera implementación se validó parcialmente en un sandbox sin red ni puertos. Después se ejecutó la suite HTTP completa y la auditoría online, se actualizaron las dependencias vulnerables detectadas y se añadieron regresiones. La auditoría es una comprobación de avisos conocidos en el momento de ejecutarla, no una garantía de ausencia de vulnerabilidades. CI está configurada, pero no se ha publicado ni ejecutado remotamente.

## Decisiones

- **Express frente a NestJS:** cinco rutas no necesitan una jerarquía de módulos. HTTP, validación, configuración, seguridad y SQL están separados en archivos pequeños.
- **SQLite frente a PostgreSQL:** permite reproducir la entrega sin servicio externo ni dependencia nativa adicional. Las consultas son síncronas: hay que medir su coste antes de aumentar carga y volumen.
- **Bloqueos:** `busy_timeout=0` evita dormir en el driver síncrono. Un conflicto temporal devuelve 503; no se reintentan escrituras automáticamente. El cliente puede reintentar ese rechazo con espera y límite de intentos.
- **Índices:** la migración `002` añade `(assignee, id)` para evitar una ordenación temporal al filtrar solo por responsable. La migración original permanece intacta.
- **Migraciones explícitas:** SQL ordenados, transacción y checksum. Repetir `pnpm migrate` es seguro; editar una migración aplicada da error. Añadir otro archivo numerado para cambios futuros; hacer backup antes de cambios de esquema.
- **TypeScript:** `noEmit: true` en la configuración base y `false` en la de build. `rewriteRelativeImportExtensions` convierte imports `.ts` a `.js` en `dist/`.
- **Fecha de calendario:** una fecha límite sin hora no debe cambiar por zonas horarias.
- **Paginación por página:** sencilla de consumir; OFFSET y el total tienen coste creciente y cambios entre peticiones pueden mover elementos entre páginas.
- **Tests:** runner de Node, HTTP real con `fetch` y SQLite aislado. Sin mocks de SQL ni framework de tests adicional.

Referencias: [seguridad en Express](https://expressjs.com/en/advanced/best-practice-security/), [SQLite en Node](https://nodejs.org/api/sqlite.html) y [configuración de express-rate-limit](https://github.com/express-rate-limit/express-rate-limit/blob/main/docs/reference/configuration.mdx).

## Con más tiempo

Usuarios con permisos por tarea, credenciales individuales revocables, OpenAPI validado contra las respuestas, readiness, logging estructurado con redacción de datos y backups con restauración probada. Para más carga: medir consultas, PostgreSQL con driver asíncrono y paginación por cursor. Añadir ETag/If-Match para impedir que dos ediciones sobrescriban cambios: actualmente gana la última escritura sobre cada campo actualizado.

## Uso de IA y trazabilidad

Implementación realizada por Codex a partir del encargo del usuario; no se atribuye autoría ni revisión humana que no ocurrió.

- **Qué se pidió:** CRUD REST con Node/TypeScript, filtros, paginación, validación, migraciones, tests, README y commits progresivos; luego pnpm, revisión de seguridad y corrección de hallazgos.
- **Qué se incorporó:** Express + SQLite, separación pequeña de responsabilidades, Zod, SQL explícito y pruebas de comportamiento. La clave compartida mantiene un modelo de cliente de confianza sin introducir usuarios que no existían en el dominio original.
- **Qué se corrigió:** npm por pnpm; Supertest por `fetch`; eliminación de tsx aprovechando Node 24; caracteres nulos, bloqueos e índice por responsable. Se conservaron los ajustes de `noEmit` aportados por el usuario. La auditoría online encontró avisos de dependencias que los tests funcionales no detectaban; se actualizaron las versiones y se añadieron autenticación, límites, cuota, rechazo de compresión y regresiones de seguridad.
- **Qué queda por evaluar antes de un despliegue:** modelo de usuarios, HTTPS y proxy, política de rotación, capacidad, copias de seguridad y observabilidad. Cero avisos en la auditoría no sustituye esa evaluación.

`git log --oneline` muestra los commits separados de diseño, persistencia, HTTP, tests, documentación y correcciones de seguridad.
