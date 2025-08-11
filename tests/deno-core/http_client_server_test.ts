import { DenoRouter } from "@neorest/router-deno";
import { Router } from "@neorest/router-core";
import { assertEquals } from "https://deno.land/std@0.203.0/testing/asserts.ts";
import { Client } from "neorest";

async function startRouter(port = 8091) {
  const router = new DenoRouter({ port });

  router
    .onGet("/echo/:id", async (ctx) => {
      ctx.response = { id: ctx.params.id, ok: true };
    })
    .onPost("/echo", async (ctx) => {
      ctx.response = ctx.data;
    })
    .onValidateBroadcast("/echo/:id", () => true);

  await router.listen();
  return router;
}

Deno.test({
  name: "HTTP client can handshake and GET",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const port = 8091;
    const router = await startRouter(port);
    try {
      const client = new Client(`http://localhost:${port}` as any, "http");
      // Call GET route
      const res = await client.get<{ id: string; ok: boolean }>("/echo/123");
      assertEquals(res.data.id, "123");
      assertEquals(res.data.ok, true);
    } finally {
      await (router as unknown as Router).close();
    }
  },
});

Deno.test({
  name: "HTTP client can POST and receive response",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const port = 8092;
    const router = await startRouter(port);
    try {
      const client = new Client(`http://localhost:${port}` as any, "http");
      const payload = { hello: "world" };
      const res = await client.post<typeof payload>("/echo", payload);
      assertEquals(res.data.hello, "world");
    } finally {
      await (router as unknown as Router).close();
    }
  },
});


