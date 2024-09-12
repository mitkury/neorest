# Neorest (Work in Progress)

REST APIs with WebSockets. Do regular REST operations (GET, POST, DELETE) on routes, and subscribe to them.

## Why?

Other libraries treat real-time channels as separate from REST APIs. That's unnecessary. When you create an API, you create structure already:

- `/users/{id}`
- `/posts/{id}`
- `/posts/{id}/comments`
- `/chat/threads/{id}`

If you can POST and GET to these endpoints, why not SUBSCRIBE to them too?

## Usage

```typescript
// Post a message
client.post('/direct-message/edoardo', { message });

// Listen for new messages
client.on('/direct-message/edoardo', (res) => { 
    console.log(res.data);
});
```