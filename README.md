# Tasks API

Una API de tareas pequeña, con decisiones explícitas y fácil de revisar. Express 5, TypeScript estricto y SQLite. Sin Docker, ORM ni servicios externos.

## Ejecutar

Requisitos: **Node.js 24.x** y **pnpm 12.21.0**.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm migrate
pnpm dev
```

La API escucha en `http://127.0.0.1:3000/api/tasks`. La base persiste en `data/tasks.sqlite`. `.env` permite cambiar `PORT`, `HOST` y `DATABASE_PATH`. Ejecuta los comandos desde la raíz del proyecto.

```sh
pnpm check       # tipos + tests + compilación
pnpm build
pnpm start      # ejecuta dist/server.js; requiere migrar antes
```

`node:sqlite` puede emitir un aviso experimental según la versión de Node 24. El cierre por SIGINT/SIGTERM deja de aceptar peticiones, espera las activas y cierra la base.

## Contrato HTTP

| Método | Ruta | Resultado |
| --- | --- | --- |
| POST | `/api/tasks` | Crea una tarea: 201 y cabecera Location |
| GET | `/api/tasks` | Lista filtrada y paginada: 200 |
| GET | `/api/tasks/:id` | Consulta: 200 o 404 |
| PATCH | `/api/tasks/:id` | Edita los campos enviados: 200 o 404 |
| DELETE | `/api/tasks/:id` | Borra: 204 sin cuerpo o 404 |

POST y PATCH requieren `Content-Type: application/json`.

```sh
curl -i http://127.0.0.1:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Preparar entrega","description":"Revisar los tests","assignee":"Ana","dueDate":"2026-12-10"}'

curl 'http://127.0.0.1:3000/api/tasks?status=pendiente&assignee=Ana&page=1&limit=10'

curl -X PATCH http://127.0.0.1:3000/api/tasks/1 \
  -H 'Content-Type: application/json' -d '{"status":"hecha"}'

curl -i -X DELETE http://127.0.0.1:3000/api/tasks/1
```

| Campo | Regla |
| --- | --- |
| `title` | Obligatorio, 1–200 caracteres tras quitar espacios exteriores |
| `description` | Obligatoria, permite cadena vacía, máximo 5000 caracteres |
| `status` | `pendiente`, `en_curso` o `hecha`; por defecto `pendiente` al crear |
| `assignee` | Obligatorio, 1–100 caracteres; nombre, sin catálogo de usuarios |
| `dueDate` | Fecha real `YYYY-MM-DD`; permite fechas vencidas |

La respuesta añade `id`, `createdAt` y `updatedAt` (timestamps UTC). PATCH exige al menos un campo. Se rechazan campos desconocidos y valores `null`. No se imponen transiciones de estado: una tarea hecha puede reabrirse.

Filtros `status` y `assignee` combinados con AND. Responsable por coincidencia exacta, sensible a mayúsculas. `page` por defecto 1 (máximo 1 000 000); `limit` por defecto 20 (máximo 100). Solo enteros positivos. Orden por ID ascendente. Parámetros desconocidos o repetidos producen 400.

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

`total` cuenta las tareas que cumplen los filtros. Una página fuera de rango devuelve una lista vacía con 200. El total y los elementos se consultan en la misma transacción de lectura.

Errores con `Content-Type: application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Datos inválidos.",
  "status": 422,
  "instance": "/api/tasks",
  "errors": [{ "field": "title", "message": "..." }]
}
```

400 para JSON mal formado, ID o query inválidos; 404 para ruta/recurso inexistente; 413 para cuerpos mayores de 32 KB; 415 para formato no soportado; 422 para datos inválidos; 500 para fallos inesperados. Los detalles internos se registran en el servidor, nunca en la respuesta.

## Pruebas y verificación de esta entrega

Hay **13 tests**: ocho de integración HTTP y cinco de persistencia, migraciones y validación. Las pruebas HTTP levantan un servidor en un puerto efímero y crean una base SQLite independiente en memoria. Las pruebas de persistencia usan un directorio temporal que se elimina al terminar.

Verificado en Node 24.18.0 con pnpm 12.21.0:

- `pnpm typecheck` y `pnpm build`: correctos.
- `pnpm test:core`: cinco tests pasan.
- `pnpm migrate`, ejecutado dos veces: correcto, sin duplicar migraciones.
- `pnpm test`: los ocho casos HTTP quedaron bloqueados en el arranque por `listen EPERM`, porque el sandbox de ejecución no permite abrir puertos. No se presentan como aprobados. Ejecutar `pnpm check` en un entorno con permisos de red local o en CI para completar la validación.

El registro de paquetes tampoco era accesible desde ese entorno. La instalación se resolvió con pnpm a partir de paquetes ya disponibles en caché. El lockfile conserva referencias normales al registro e integridades, sin rutas locales. La comprobación final de instalación offline no pudo completar la política de dependencias de pnpm por falta de metadatos completos de `inherits` en caché; no se desactivó esa política. La ejecución de CI está configurada, pero no se ha publicado ni ejecutado remotamente.

## Decisiones

- **Express frente a NestJS:** el alcance cabe en cinco rutas. La separación entre HTTP (`app.ts`), validación (`validation.ts`) y SQL (`tasks.ts`) permite ampliar el proyecto sin una jerarquía de capas vacías.
- **SQLite frente a PostgreSQL:** facilita reproducir la entrega. El driver incluido en Node evita una dependencia nativa adicional. Las consultas son síncronas: adecuado para este tamaño, pero bloquean el event loop durante su ejecución.
- **SQL parametrizado:** los valores del cliente no se interpolan. Las columnas de PATCH salen de un mapa cerrado validado.
- **Fecha de calendario:** una fecha límite sin hora no debe cambiar al convertir zonas horarias.
- **Migraciones explícitas:** `pnpm migrate` aplica los SQL ordenados dentro de una transacción y registra su checksum. Repetirlo es seguro; editar una migración aplicada da error. Para cambios futuros, añadir otro archivo numerado. No hay rollback destructivo automático; hacer backup antes de cambios de esquema.
- **Paginación por página:** sencilla para quien consume la API. El orden es determinista, pero cambios entre peticiones pueden mover elementos entre páginas.
- **Tests con herramientas de Node:** HTTP real con `fetch`, runner `node:test`, SQLite aislado por test y una base temporal para verificar persistencia. Sin mocks de SQL ni framework de tests adicional.

Referencias técnicas: [errores en Express 5](https://expressjs.com/en/guide/error-handling/) y [SQLite en Node](https://nodejs.org/api/sqlite.html).

## Con más tiempo

Autenticación y autorización por responsable, usuarios con identificadores, OpenAPI validado contra las respuestas, logging estructurado y límites de peticiones. Para más carga: medir consultas, migrar a PostgreSQL con driver asíncrono y evaluar paginación por cursor. Añadir control de concurrencia con ETag/If-Match para evitar que dos ediciones se sobrescriban. Actualmente gana la última escritura; la API está pensada para evaluación local, sin control de acceso.

## Uso de IA y trazabilidad

Esta implementación fue realizada por Codex a partir del encargo del usuario; no pretende atribuir revisión manual ni autoría humana que no ocurrió.

- **Qué se pidió:** CRUD REST con Node/TypeScript, filtros, paginación, validación, migraciones, al menos tres tests, README y commits progresivos. Después se pidió usar pnpm.
- **Qué se incorporó:** Express + SQLite, separación pequeña de responsabilidades, validación Zod, migraciones SQL y pruebas de comportamiento. Estas fueron decisiones del agente dentro de las alternativas autorizadas, no aprobaciones humanas adicionales.
- **Qué se corrigió durante el trabajo:** se cambió npm por pnpm tras la indicación del usuario. Se sustituyó el borrador con Supertest por `fetch` y `node:test`, reduciendo dependencias. Se eliminó también tsx: Node 24 ejecuta directamente el TypeScript empleado, y TypeScript compila la distribución JavaScript. La falta de acceso al registro obligó a recuperar dependencias desde la caché local para verificar el proyecto.
- **Qué se debe revisar:** los supuestos de dominio (responsable como nombre, fechas sin hora y reapertura de tareas), las limitaciones de concurrencia y el contrato HTTP antes de integrarlo en otro sistema.

El historial Git separa diseño, persistencia, HTTP, pruebas y documentación. `git log --oneline` muestra esa evolución.
