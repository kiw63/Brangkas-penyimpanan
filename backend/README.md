# BRANKAS Backend

Backend API untuk BRANKAS.

## Runtime

- Node.js 20+
- Express
- PostgreSQL
- Cloudflare R2
- Argon2id

## Endpoint utama

### Status

GET `/api/status`

### Setup

POST `/api/setup`

Body:

```json
{
  "password": "password-minimal-12-karakter",
  "redeem": "redeem-code"
}
