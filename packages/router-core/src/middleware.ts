export interface RequestContextLike {
  headers: Record<string, string>;
  error?: string;
  statusCode?: number;
}

export type RouteHandler<Ctx extends RequestContextLike = RequestContextLike> = (ctx: Ctx) => void | Promise<void>;

export type TokenValidator<Ctx extends RequestContextLike = RequestContextLike> = (token: string, ctx: Ctx) => boolean | Promise<boolean>;

export function withAuth<Ctx extends RequestContextLike = RequestContextLike>(
  validateToken: TokenValidator<Ctx>,
  handler: RouteHandler<Ctx>
): RouteHandler<Ctx> {
  return async (ctx: Ctx) => {
    const raw = ctx.headers?.['authorization'] || ctx.headers?.['Authorization'] || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;

    const ok = await Promise.resolve(validateToken(token, ctx));
    if (!ok) {
      ctx.statusCode = 401;
      ctx.error = 'Unauthorized';
      return;
    }

    await handler(ctx);
  };
}