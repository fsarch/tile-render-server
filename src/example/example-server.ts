import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import minimist from "minimist";

type MimeTypeMap = Record<string, string>;

const MIME_TYPES: MimeTypeMap = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

interface ServerOptions {
  outputDir: string;
  apiBaseUrl: string;
  port: number;
  host: string;
}

interface NodeErrorWithCode {
  code?: string;
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function isInside(base: string, target: string): boolean {
  const relBase = resolve(base);
  const relTarget = resolve(target);
  return relTarget === relBase || relTarget.startsWith(`${relBase}/`);
}

function parseArgs(): ServerOptions {
  const args = minimist(process.argv.slice(2), {
    default: {
      output: "output",
      "api-base": "http://127.0.0.1:3000",
      port: 4173,
      host: "127.0.0.1",
    },
    boolean: ["help"],
  });

  if (args.help) {
    console.log(`Usage: node dist/example-server.js [options]

--output <dir>   Tile output directory (default: output)
--api-base <url> API base URL for on-demand tiles (default: http://127.0.0.1:3000)
--port <number>  Port for the example server (default: 4173)
--host <host>    Host for the example server (default: 127.0.0.1)
--help           Show this help
`);
    process.exit(0);
  }

  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port value: ${args.port}`);
  }

  return {
    outputDir: resolve(String(args.output)),
    apiBaseUrl: String(args["api-base"]).replace(/\/+$/, ""),
    port,
    host: String(args.host),
  };
}

async function sendFile(res: ServerResponse, path: string): Promise<void> {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const body = await readFile(path);
  res.statusCode = 200;
  res.setHeader("Content-Type", getMimeType(path));
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
}

async function proxyApi(res: ServerResponse, apiBaseUrl: string, path: string): Promise<void> {
  const upstream = await fetch(`${apiBaseUrl}${path}`);
  const body = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = upstream.status;
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }
  res.end(body);
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
}

const options = parseArgs();
const srcDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(srcDir, "..", "..");
// Static assets aren't compiled by tsc, so they stay put in src/ and are served
// straight from there - even when this file itself is running as compiled dist/ JS.
const exampleDir = resolve(projectRoot, "src", "example", "public");

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const rawUrl = req.url ?? "/";
    const pathOnly = rawUrl.split("?")[0] ?? "/";
    const decodedPath = decodeURIComponent(pathOnly);

    if (decodedPath === "/" || decodedPath === "/index.html") {
      await sendFile(res, resolve(exampleDir, "index.html"));
      return;
    }

    if (decodedPath === "/style.css" || decodedPath === "/app.js") {
      const filePath = resolve(exampleDir, decodedPath.slice(1));
      if (!isInside(exampleDir, filePath)) {
        notFound(res);
        return;
      }
      await sendFile(res, filePath);
      return;
    }

    if (decodedPath.startsWith("/tiles/")) {
      const tileRelative = decodedPath.replace(/^\/tiles\//, "");
      const tilePath = resolve(options.outputDir, tileRelative);
      if (!isInside(options.outputDir, tilePath)) {
        notFound(res);
        return;
      }
      await sendFile(res, tilePath);
      return;
    }

    if (decodedPath.startsWith("/v1/")) {
      // Proxies any v1 API route, not just tile rendering - the light/dark toggle also
      // needs GET /v1/templates (see app.js) to look up template ids by name.
      await proxyApi(res, options.apiBaseUrl, decodedPath);
      return;
    }

    notFound(res);
  } catch (error) {
    const maybeError = error as NodeErrorWithCode;
    if (maybeError && maybeError.code === "ENOENT") {
      notFound(res);
      return;
    }
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(error instanceof Error ? error.message : "Internal server error");
  }
});

server.listen(options.port, options.host, () => {
  console.log(
    `Example server running at http://${options.host}:${options.port} (api ${options.apiBaseUrl})`
  );
});
