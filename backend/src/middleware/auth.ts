import { auth } from "../lib/auth.js";
import type { RequestHandler } from 'express';
import { fromNodeHeaders } from "better-auth/node";

export const requireAuth: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.session = {
    user: session.user,
    session: session.session,
  };

  next();
};