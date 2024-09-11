import { serveDir } from "https://deno.land/std/http/file_server.ts";

Deno.serve({ port: 8000 }, (req) => serveDir(req, { fsRoot: "../front" }));