# Decisiones iniciales

Objetivo: entregar una API REST de tareas fácil de ejecutar y revisar.

- Express + TypeScript estricto: cinco rutas, sin necesidad de módulos de NestJS.
- SQLite mediante node:sqlite (Node 24): cero servicio externo y SQL visible.
- Alternativas: NestJS para una aplicación con más módulos; PostgreSQL para múltiples instancias y mayor concurrencia de escritura.
- Separar HTTP, validación y persistencia; evitar capas sin lógica propia.
- Estados: pendiente, en_curso, hecha. Responsable como texto; no se solicita un sistema de usuarios.
- Fecha límite YYYY-MM-DD, sin zona horaria; se permiten tareas vencidas.
- Listado con filtros combinables, orden estable por ID, página y límite acotados.
- Migraciones SQL versionadas y transaccionales. Nunca modificar una migración aplicada.
- Errores JSON uniformes: 400 sintaxis/query, 404 ausencia, 415 formato, 422 datos, 500 inesperado.
- Tests de integración HTTP con SQLite real aislado y tests de migraciones/persistencia.
- Commits separados: diseño, persistencia, API, tests y documentación.

No se incluyen autenticación, frontend, despliegue ni abstracciones para bases de datos hipotéticas.
