import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function authenticate(apiToken: string): RequestHandler {
  if (typeof apiToken !== 'string' || !/^[a-f0-9]{64}$/.test(apiToken)) {
    throw new Error('API_TOKEN debe contener 64 caracteres hexadecimales aleatorios.');
  }
  const expected = createHash('sha256').update(apiToken).digest();
  return (req, res, next) => {
    const header = req.get('authorization');
    const match = header?.match(/^Bearer ([a-f0-9]{64})$/i);
    const count = req.rawHeaders.filter((_, index) => index % 2 === 0)
      .filter(name => name.toLowerCase() === 'authorization').length;
    if (count !== 1 || !match?.[1] || !timingSafeEqual(expected, createHash('sha256').update(match[1]).digest())) {
      res.set('WWW-Authenticate', 'Bearer realm="tasks-api"');
      res.status(401).type('application/problem+json').json({
        type: 'about:blank', title: 'Credenciales ausentes o inválidas.', status: 401, instance: req.path,
      });
      return;
    }
    next();
  };
}
