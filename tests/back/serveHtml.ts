import { serve } from "https://deno.land/std/http/server.ts";
import { serveDir } from "https://deno.land/std/http/file_server.ts";

// Serve the HTML files from the 'front' directory
serve((req) => serveDir(req, { fsRoot: "../front" }));