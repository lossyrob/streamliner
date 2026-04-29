import type { NextFunction, Request, Response } from "express";

import { type ScopedLogger } from "../logger";

export interface AccessLogOptions {
  logger: ScopedLogger;
  /** Paths that should be skipped (e.g. long-lived SSE streams). */
  skip?: (path: string) => boolean;
}

export function createAccessLogMiddleware(options: AccessLogOptions) {
  const { logger, skip } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.originalUrl ?? req.url ?? "";
    if (skip && skip(path)) {
      next();
      return;
    }

    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const status = res.statusCode;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      logger[level]("request", {
        method: req.method,
        path,
        status,
        durationMs,
      });
    });

    next();
  };
}
