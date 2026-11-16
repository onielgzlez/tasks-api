import { z } from 'zod';

const configSchema = z.object({
  API_TOKEN: z.string().regex(/^[a-f0-9]{64}$/),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).default('./data/tasks.sqlite'),
  REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(300),
  MAX_TASKS: z.coerce.number().int().min(1).max(100_000).default(10_000),
});

export function readConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Configuration failures identify fields only, never their secret values.
    const fields = [...new Set(result.error.issues.map(issue => issue.path.join('.')))];
    throw new Error(`Configuración inválida: ${fields.join(', ')}. Revisa .env.example y el README.`);
  }
  return result.data;
}
