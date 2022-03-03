# dash-webhook-client

Registers an address with the test webhook service and logs out payments to that address.

<kbd><img width="606" alt="payment demo screenshot" src="https://user-images.githubusercontent.com/122831/156580178-6e84bc85-0804-4dc1-aa8a-553cf97ed0e6.png"></kbd>

```bash
npm ci
npx knex migrate:latest
```

```bash
node server.js
```

```bash
curl -X POST http://localhost:3274/api/hello \
  -H 'Authorization: Token YOUR_TOKEN'
```

# Pre-reqs

- PostgreSQL: https://webinstall.dev/postgres
- Node.js: https://webinstall.dev/node
