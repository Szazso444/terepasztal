import type { Plugin } from 'vite';

/** Local diagnostics only: recent browser traffic reports, never saves or remote commands. */
export function trafficDiagnostics(): Plugin {
  return {
    name: 'traffic-diagnostics',
    apply: 'serve',
    configureServer(server) {
      const reports = new Map<string, { received: number; report: unknown }>();
      server.ws.on('traffic:report', (data: { id?: string; report?: unknown }) => {
        if (typeof data?.id !== 'string' || data.id.length > 80) return;
        if (JSON.stringify(data).length > 250000) return;
        reports.set(data.id, { received: Date.now(), report: data.report });
        if (reports.size > 8) reports.delete(reports.keys().next().value!);
      });
      server.middlewares.use('/__traffic', (req, res) => {
        const ip = req.socket.remoteAddress;
        if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
          res.statusCode = 403;
          res.end();
          return;
        }
        for (const [id, entry] of reports)
          if (Date.now() - entry.received > 60000) reports.delete(id);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify([...reports].map(([id, entry]) => ({ id, ...entry }))));
      });
    },
  };
}
