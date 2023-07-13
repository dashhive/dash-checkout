# Dash Merchant Payments Demo

Registers an address with the test webhook service and logs out payments to that address.

<kbd><img width="606" alt="payment demo screenshot" src="https://user-images.githubusercontent.com/122831/156580178-6e84bc85-0804-4dc1-aa8a-553cf97ed0e6.png"></kbd>

```sh
npm ci
```

```sh
# copy the env file
cp -RpP example.env .env

# season to taste
vi .env
```

```sh
npx knex migrate:latest
npm run start
```

```sh
curl -X POST http://localhost:3274/api/hello \
  -H 'Authorization: Token YOUR_TOKEN'
```

# Pre-reqs

- PostgreSQL: https://webinstall.dev/postgres
- Node.js: https://webinstall.dev/node

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
Authorization: Bearer Tttttttttttttttttttt

{
}
```

## Merchant Payment API

```txt
GET /api/public/plans

[
    {
        "trial": {
            "amount": 0.001,
            "soft_duration_hours": 24,
            "hard_duration_hours": 72,
            "soft_quota": 100,
            "hard_quota": 110
        },
        "monthly": {
            "amount": 0.01,
            "soft_duration_days": 30,
            "hard_duration_days": 34,
            "soft_quota": 10000,
            "hard_quota": 11000
        }
    }
]
```

The webhook is authenticated with HTTP Basic Auth. It uses either the given username and password or a dummy username and the token as the password.

```txt
POST /api/webhooks/payment-accepted
Authorization: Basic Mmmmmmmmmmmmmmmmmmmmmmmm

{
    "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "event": "txlock",
    "satoshis": 100100100,
    "txid": "0000000000000000000000000000000000000000000000000000000000000000"
}

{
    "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "satoshis": 100100100
}
```

## Internal Service API

Receive payment confirmation webhooks from a Dash WebHook Service

```txt
POST /api/webhooks/
Authorization: Bearer Txxxxxxxxxxxxxxxxxxxxxxx

{
    "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "url": "https://[api:token@]example.com/api/webhooks/payment-accepted",
}
```

The webhook is authenticated with HTTP Basic Auth. It uses either the given username and password or a dummy username and the token as the password.

```txt
POST /api/full-node-webhooks/dwh
Authorization: Basic <Base64(api:xxxxxxxxxxxxxxxxxxxxxxx)>

{
    "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "event": "txlock",
    "satoshis": 100100100,
    "txid": "0000000000000000000000000000000000000000000000000000000000000000"
}

{
    "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccc",
    "satoshis": 100100100
}
```
