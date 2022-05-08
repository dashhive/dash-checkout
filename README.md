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

-   PostgreSQL: https://webinstall.dev/postgres
-   Node.js: https://webinstall.dev/node

## API

### Create an Order for an API token

Provide optional contact information for low-balance / near-quota notifications.

```txt
POST /api/public/account/:plan
{
    "token": "[optional existing token]",
    "email": "[optional email]",
    "phone": "[optional phone]",
    "webhook": "[optional webhook url]"
}

{
    "payaddr": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "amount": "<cost of plan in Dash>",
    "token": "<token that will be activated (or refreshed) upon payment>",
    "status_url": "{baseUrl}/api/public/account/{token}/status",
    "qr": {
        "src": "data:image/svg+xml;base64,{svgB64}",
        "api_src": "{baseUrl}/api/payment-addresses/{payaddr}.svg?{search}",
    }
}
```

### Get the Payment Address QR Code

```txt
GET /api/public/payment-addresses/:addr.svg

<!DOCTYPE SVG>
<?xml version="1.0" standalone="yes"?>
<svg>...</svg>
```

Poll for the status of the token (valid on payment)

<!-- TODO remove 'id' from output? -->

```txt
GET /api/public/account/:token/status

{
    "status": "<pending|complete>",
    "token": "api_xxxxxxxxx",
    "soft_quota": 10,
    "hard_quota": 12,
    "stale_at": "2022-05-08T12:00:00",
    "expires_at": "2022-05-09T12:00:00",
    "amount": 100100100,
}
```

```txt
GET /api/hello

{
}
```

## Internal API

Receive payment confirmation webhooks from a Dash WebHook Service

```txt
POST /api/webhooks/dwh
{
    "ddress": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "satoshis": 100100100
}

{
    "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "satoshis": 100100100
}
```
