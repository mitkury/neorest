import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ port: 3000 });

router.onGet('/ping', (context) => {
  context.response = 'pong';
});

await router.start();
