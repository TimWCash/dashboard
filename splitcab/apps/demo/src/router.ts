// Just enough of Fastify's interface to run the API's route modules in the browser.

type Handler = (req: DemoRequest, reply: DemoReply) => unknown;
type ErrorHandler = (err: unknown, req: DemoRequest, reply: DemoReply) => unknown;
type RouteOptions = { preHandler?: Handler | Handler[] };

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  preHandlers: Handler[];
  handler: Handler;
}

export interface DemoRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
  ip: string;
  userId: string;
  log: Logger;
}

export interface Logger {
  [level: string]: unknown;
}

export class DemoReply {
  statusCode = 200;
  sent = false;
  payload: unknown = undefined;

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  code(code: number) {
    return this.status(code);
  }
  header() {
    return this;
  }
  send(payload?: unknown) {
    this.sent = true;
    this.payload = payload;
    return this;
  }
}

export class DemoApp {
  private routes: Route[] = [];
  private errorHandler: ErrorHandler = (err) => {
    throw err;
  };
  private notFoundHandler: Handler = (_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });

  constructor(private log: Logger) {}

  private add(method: string, path: string, a: RouteOptions | Handler, b?: Handler) {
    const options = typeof a === 'function' ? {} : a;
    const handler = typeof a === 'function' ? a : b!;
    const keys: string[] = [];
    const source = path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    const pre = options.preHandler;
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, preHandlers: pre ? [pre].flat() : [], handler });
  }

  get(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('GET', path, a, b);
  }
  post(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('POST', path, a, b);
  }
  patch(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('PATCH', path, a, b);
  }
  delete(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('DELETE', path, a, b);
  }
  // Plugins (the Stripe webhook scope) aren't needed in the demo.
  register() {}
  setErrorHandler(handler: ErrorHandler) {
    this.errorHandler = handler;
  }
  setNotFoundHandler(handler: Handler) {
    this.notFoundHandler = handler;
  }

  async handle(method: string, url: URL, headers: Record<string, string>, body: unknown): Promise<{ status: number; payload: unknown }> {
    const req: DemoRequest = {
      method,
      url: url.pathname + url.search,
      headers,
      query: Object.fromEntries(url.searchParams),
      params: {},
      body,
      ip: '127.0.0.1',
      userId: '',
      log: this.log,
    };
    const reply = new DemoReply();
    try {
      const route = this.match(method, url.pathname, req);
      if (!route) {
        await this.notFoundHandler(req, reply);
      } else {
        for (const pre of route.preHandlers) await pre(req, reply);
        const result = await route.handler(req, reply);
        if (!reply.sent && result !== reply) reply.send(result);
      }
    } catch (err) {
      const fresh = new DemoReply();
      await this.errorHandler(err, req, fresh);
      return { status: fresh.statusCode, payload: fresh.payload };
    }
    return { status: reply.statusCode, payload: reply.payload };
  }

  private match(method: string, path: string, req: DemoRequest): Route | undefined {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      route.keys.forEach((key, i) => (req.params[key] = decodeURIComponent(m[i + 1]!)));
      return route;
    }
    return undefined;
  }
}
