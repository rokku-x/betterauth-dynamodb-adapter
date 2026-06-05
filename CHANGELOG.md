# betterauth-dynamodb-adapter

## 0.1.4

### Patch Changes

- 3b9e82d: feat(adapter): add TTL field conversion for DynamoDB compatibility

  - Add `toStorage()` function to convert `expiresAt` ISO strings to Unix epoch seconds for DynamoDB TTL compatibility
  - Add `fromStorage()` function to convert `expiresAt` epoch seconds back to ISO strings when reading from DynamoDB
  - Update `strip()` to call `fromStorage()` for consistent field conversion on retrieval
  - Apply `toStorage()` conversion in `create()` operation before storing items
  - Apply `toStorage()` conversion in single-item `update()` operation before updating fields
  - Apply `toStorage()` conversion in batch `updateMany()` operation before updating multiple items
  - Update README with explanation of TTL format compatibility and automatic conversion behavior
  - Ensures Better Auth receives data in expected ISO format while DynamoDB stores timestamps as epoch seconds

## 0.1.3

### Patch Changes

- ef70a71: feat(tooling): add ESLint, error handling, validation, and documentation

  - Add ESLint configuration with TypeScript support and lint scripts
  - Implement DynamoDBAdapterError custom error class for better error handling
  - Add comprehensive try-catch blocks around all DynamoDB operations
  - Add input validation for tableName, model, where conditions, data, limit, and offset
  - Add JSDoc comments to adapter function, error class, and all 8 adapter methods
  - Add .npmignore to exclude source files and config from npm package
  - Update README with pnpm and yarn installation instructions
  - Add TTL configuration examples for AWS CLI, CDK, and Terraform
  - Update dependencies with eslint, @eslint/js, typescript-eslint, and jiti
  - Update tsconfig.json and tsdown.config.ts for improved build configuration

## 0.1.1

### Patch Changes

- 16370f2: initial release
- 1e26d79: feat: added test cases
