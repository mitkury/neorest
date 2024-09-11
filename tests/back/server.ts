const ac = new AbortController();

const server = Deno.serve({ port: 8001, signal: ac.signal }, (req) => {
  console.log(req.url);

  return new Response(req.url)
});

server.finished.then(() => console.log("Server closed"));