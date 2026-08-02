import { randomUUID } from 'node:crypto';
import { NodeRouter } from 'neorest/node';

type Message = { id: string; text: string };

const messages: Message[] = [];
const router = new NodeRouter({ port: 3002 });

router.onGet('/messages', (context) => {
  context.response = messages;
});

router.onPost('/messages', (context) => {
  const text = String((context.data as { text?: unknown })?.text ?? '').trim();

  if (!text) {
    context.statusCode = 400;
    context.error = 'text is required';
    return;
  }

  const message = { id: randomUUID(), text };
  messages.push(message);
  context.response = message;
  router.broadcastPost('/messages', message, context.sender);
});

await router.start();
