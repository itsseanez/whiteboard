import type { Request, Response } from 'express';

export function getContext(req: Request, res: Response) {
  res.json({
    tenant: req.tenant,
    membership: req.membership,
  });
}