---
"betterauth-dynamodb-adapter": patch
---

feat(adapter): add TTL field conversion for DynamoDB compatibility

- Add `toStorage()` function to convert `expiresAt` ISO strings to Unix epoch seconds for DynamoDB TTL compatibility
- Add `fromStorage()` function to convert `expiresAt` epoch seconds back to ISO strings when reading from DynamoDB
- Update `strip()` to call `fromStorage()` for consistent field conversion on retrieval
- Apply `toStorage()` conversion in `create()` operation before storing items
- Apply `toStorage()` conversion in single-item `update()` operation before updating fields
- Apply `toStorage()` conversion in batch `updateMany()` operation before updating multiple items
- Update README with explanation of TTL format compatibility and automatic conversion behavior
- Ensures Better Auth receives data in expected ISO format while DynamoDB stores timestamps as epoch seconds
