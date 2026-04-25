#!/usr/bin/env node

const http = require('http');
const https = require('https');

const PROXY_PORT = process.env.MCP_PROXY_PORT || 8002;
const TARGET_PORT = process.env.PORT || 8001;
const TARGET_HOST = 'localhost';

const server = http.createServer((req, res) => {
  if (req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    const headers = { ...req.headers };
    delete headers['host'];
    delete headers['connection'];
    
    if (body) {
      headers['content-length'] = Buffer.byteLength(body);
    }

    const options = {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: '/mcp',
      method: req.method,
      headers: headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[MCP Proxy] Error forwarding request: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Bad Gateway', 
          message: 'Target service unavailable',
          details: err.message 
        }));
      }
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`[MCP Proxy] Listening on port ${PROXY_PORT}`);
  console.log(`[MCP Proxy] Forwarding to http://${TARGET_HOST}:${TARGET_PORT}/mcp`);
});

process.on('SIGTERM', () => {
  console.log('[MCP Proxy] Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('[MCP Proxy] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[MCP Proxy] Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('[MCP Proxy] Server closed');
    process.exit(0);
  });
});
