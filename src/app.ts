import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { TaskRepository } from './tasks.ts';
import { isDatabaseBusy } from './database.ts';
import { createTaskSchema, idSchema, querySchema, updateTaskSchema } from './validation.ts';

class HttpError extends Error {
  readonly status: number;
  readonly errors?: unknown;
  constructor(status: number, message: string, errors?: unknown) {
    super(message); this.status = status; this.errors = errors;
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown, status = 422): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(status, 'Datos inválidos.', result.error.issues.map(issue => ({
    field: issue.path.join('.'), message: issue.message,
  })));
  return result.data;
}
function found<T>(value: T | undefined): T {
  if (value === undefined) throw new HttpError(404, 'Tarea no encontrada.');
  return value;
}

export function createApp(db: DatabaseSync, logError: (error: unknown) => void = console.error) {
  const app = express();
  const tasks = new TaskRepository(db);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api/tasks', (req, _res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Usa Content-Type: application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.post('/api/tasks', (req, res) => {
    const task = tasks.create(parse(createTaskSchema, req.body));
    res.location(`/api/tasks/${task.id}`).status(201).json(task);
  });
  app.get('/api/tasks', (req, res) => res.json(tasks.list(parse(querySchema, req.query, 400))));
  app.get('/api/tasks/:id', (req, res) => res.json(found(tasks.get(parse(idSchema, req.params.id, 400)))));
  app.patch('/api/tasks/:id', (req, res) => {
    const id = parse(idSchema, req.params.id, 400);
    res.json(found(tasks.update(id, parse(updateTaskSchema, req.body))));
  });
  app.delete('/api/tasks/:id', (req, res) => {
    if (!tasks.delete(parse(idSchema, req.params.id, 400))) throw new HttpError(404, 'Tarea no encontrada.');
    res.status(204).end();
  });
  app.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    let problem = error instanceof HttpError ? error : undefined;
    if (!problem && isDatabaseBusy(error)) {
      problem = new HttpError(503, 'Base de datos ocupada. Inténtalo de nuevo más tarde.');
      res.set('Retry-After', '1');
    }
    const bodyError = error as { type?: string; status?: number } | null;
    if (!problem && bodyError?.type === 'entity.parse.failed') problem = new HttpError(400, 'JSON mal formado.');
    if (!problem && bodyError?.type === 'entity.too.large') problem = new HttpError(413, 'El cuerpo supera 32 KB.');
    if (!problem && bodyError?.status === 415) problem = new HttpError(415, 'Codificación no soportada.');
    if (!problem) { logError(error); problem = new HttpError(500, 'Error interno del servidor.'); }
    res.status(problem.status).type('application/problem+json').json({
      type: 'about:blank', title: problem.message, status: problem.status,
      instance: req.path, ...(problem.errors ? { errors: problem.errors } : {}),
    });
  };
  app.use(errorHandler);
  return app;
}
