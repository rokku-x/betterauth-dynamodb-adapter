# betterauth-dynamodb-adapter

[![npm version](https://img.shields.io/npm/v/betterauth-dynamodb-adapter.svg)](https://www.npmjs.com/package/betterauth-dynamodb-adapter)
[![license](https://img.shields.io/npm/l/betterauth-dynamodb-adapter.svg)](LICENSE)
![TS](https://img.shields.io/badge/TypeScript-%E2%9C%93-blue)

A DynamoDB adapter for [Better Auth](https://www.better-auth.com/). Uses a single-table design with composite keys and a GSI for model-based queries.

## Features

- Single-table design — all Better Auth models stored in one DynamoDB table
- Composite primary keys (`_pk` / `_sk`) for direct item access
- GSI-based queries via a `_table` attribute for model-level scans
- Full filter expression support (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `contains`, `starts_with`, `ends_with`)
- Fast path `GetItem` for single-ID lookups
- In-memory sorting and pagination for `findMany`
- Dual CJS/ESM build with full TypeScript declarations

## Installation

```bash
npm install betterauth-dynamodb-adapter
# or
bun add betterauth-dynamodb-adapter
# or
pnpm add betterauth-dynamodb-adapter
# or
yarn add betterauth-dynamodb-adapter
```

### Peer dependencies

You also need these installed in your project:

```bash
npm install better-auth @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## DynamoDB Table Setup

Create a DynamoDB table with the following schema:

| Attribute | Type   | Role          |
|-----------|--------|---------------|
| `_pk`     | String | Partition key |
| `_sk`     | String | Sort key      |

Then create a Global Secondary Index:

| Index Name     | Partition Key | Type   |
|----------------|---------------|--------|
| `_table-index` | `_table`      | String |

Optionally, enable TTL on `expiresAt` to auto-expire sessions and verification tokens.


### AWS CLI

```bash
aws dynamodb create-table \
  --table-name my-auth-table \
  --attribute-definitions \
    AttributeName=_pk,AttributeType=S \
    AttributeName=_sk,AttributeType=S \
    AttributeName=_table,AttributeType=S \
  --key-schema \
    AttributeName=_pk,KeyType=HASH \
    AttributeName=_sk,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "_table-index",
      "KeySchema": [{"AttributeName": "_table", "KeyType": "HASH"}],
      "Projection": {"ProjectionType": "ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST

aws dynamodb update-time-to-live \
  --table-name my-auth-table \
  --time-to-live-specification "Enabled=true, AttributeName=expiresAt"
```

### CDK

```ts
import { Table, AttributeType, BillingMode, ProjectionType } from "aws-cdk-lib/aws-dynamodb";

const table = new Table(this, "AuthTable", {
  tableName: "my-auth-table",
  partitionKey: { name: "_pk", type: AttributeType.STRING },
  sortKey: { name: "_sk", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
});

table.addGlobalSecondaryIndex({
  indexName: "_table-index",
  partitionKey: { name: "_table", type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});

table.addTimeToLive({ attribute: "expiresAt" });
```

### Terraform

```hcl
resource "aws_dynamodb_table" "auth" {
  name         = "my-auth-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "_pk"
  range_key    = "_sk"

  attribute {
    name = "_pk"
    type = "S"
  }

  attribute {
    name = "_sk"
    type = "S"
  }

  attribute {
    name = "_table"
    type = "S"
  }

  global_secondary_index {
    name            = "_table-index"
    hash_key        = "_table"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}
```

## Usage

> Your DynamoDB table must already exist before using this adapter. See [DynamoDB Table Setup](#dynamodb-table-setup) above.

### Basic setup

```ts
// auth.ts
import { betterAuth } from "better-auth";
import dynamoDBAdapter from "betterauth-dynamodb-adapter";

export const auth = betterAuth({
  database: dynamoDBAdapter({
    tableName: "my-auth-table",
    region: "us-east-1",
  }),
  emailAndPassword: {
    enabled: true,
  },
});
```

### With social providers

```ts
// auth.ts
import { betterAuth } from "better-auth";
import dynamoDBAdapter from "betterauth-dynamodb-adapter";

export const auth = betterAuth({
  database: dynamoDBAdapter({
    tableName: "my-auth-table",
    region: "us-east-1",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
});
```

### With Next.js

```ts
// app/api/auth/[...all]/route.ts
import { auth } from "@/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

### Client-side

```ts
// lib/auth-client.ts
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient();

// Sign up
await authClient.signUp.email({
  email: "[email]",
  password: "[password]",
  name: "[name]",
});

// Sign in
await authClient.signIn.email({
  email: "[email]",
  password: "[password]",
});
```

## How It Works

### Single-table design

All Better Auth models (users, sessions, accounts, etc.) are stored in a single DynamoDB table. Each item has three internal attributes managed by the adapter:

| Attribute | Format         | Purpose                         |
|-----------|----------------|---------------------------------|
| `_pk`     | `{model}#{id}` | Partition key for direct access |
| `_sk`     | `{model}#{id}` | Sort key (same as `_pk`)        |
| `_table`  | `{model}`      | GSI partition key for queries   |

These internal attributes are automatically stripped from results returned to Better Auth.

### Query strategy

- **Single ID lookup** → `GetItem` (fastest, single read unit)
- **Filtered queries** → GSI query on `_table-index` with DynamoDB `FilterExpression`
- **Sorting & pagination** → performed in-memory after query results are returned

### Supported filter operators

| Operator      | DynamoDB expression         |
|---------------|-----------------------------|
| `eq`          | `field = value`             |
| `ne`          | `field <> value`            |
| `gt`          | `field > value`             |
| `gte`         | `field >= value`            |
| `lt`          | `field < value`             |
| `lte`         | `field <= value`            |
| `in`          | `field IN (values)`         |
| `not_in`      | `NOT field IN (values)`     |
| `contains`    | `contains(field, value)`    |
| `starts_with` | `begins_with(field, value)` |
| `ends_with`   | `contains(field, value)` *  |

> \* DynamoDB does not natively support `ends_with`, so it falls back to `contains`.

## Configuration

```ts
dynamoDBAdapter({
  tableName: string;  // DynamoDB table name
  region: string;     // AWS region (e.g. "us-east-1")
})
```

## Adapter Capabilities

| Capability      | Supported |
|-----------------|-----------|
| JSON fields     | No        |
| Date fields     | No        |
| Boolean fields  | No        |
| Numeric IDs     | No        |

All values are stored as DynamoDB strings/numbers. Dates should be stored as ISO strings or Unix timestamps by Better Auth before reaching the adapter.

## License

[MIT](LICENSE)
