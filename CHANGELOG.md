# betterauth-dynamodb-adapter

## 0.1.2

### Patch Changes

- 33344d4: feat(tooling): add ESLint, error handling, validation, and documentation

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
