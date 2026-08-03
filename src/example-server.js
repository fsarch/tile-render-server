import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import minimist from "minimist";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function getMimeType(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function isInside(base, target) {
  const relBase = resolve(base);
  const relTarget = resolve(target);
  return relTarget === relBase || relTarget.startsWith(`${relBase}/`);
}

function parseArgs() {
  const args = minimist(process.argv.slice(2), {
    default: {
      output: "output",
      port: 4173,
      host: "127.0.0.1",
    },
    boolean: ["help"],
  });

  if (args.help) {
    console.log(`Usage: node src/example-server.js [options]

--output <dir>   Tile output directory (default: output)
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
    port,
    host: String(args.host),
  };
}

async function sendFile(res, path) {
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

function notFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
}

const options = parseArgs();
const srcDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(srcDir, "..");
const exampleDir = resolve(projectRoot, "example");

const server = createServer(async (req, res) => {
  try {
    const rawUrl = req.url ?? "/";
    const pathOnly = rawUrl.split("?")[0];
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

    notFound(res);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
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
    `Example server running at http://${options.host}:${options.port} (tiles from ${options.outputDir})`
  );
});

