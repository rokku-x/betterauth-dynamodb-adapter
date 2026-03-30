import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
    DeleteItemCommand,
    QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import dynamoDBAdapter from "../index";

const ddbMock = mockClient(DynamoDBClient);

function getAdapter() {
    const factory = dynamoDBAdapter({ tableName: "test-table", region: "us-east-1" });
    // createAdapterFactory returns a function; call it to get the adapter methods
    return (factory as unknown)({ options: {} });
}

beforeEach(() => {
    ddbMock.reset();
});

describe("create", () => {
    it("should put an item and return it without internal keys", async () => {
        ddbMock.on(PutItemCommand).resolves({});

        const adapter = getAdapter();
        const result = await adapter.create({
            model: "user",
            data: { name: "Alice", email: "alice@test.com" },
        });

        expect(result).toHaveProperty("id");
        expect(result.name).toBe("Alice");
        expect(result.email).toBe("alice@test.com");
        expect(result).not.toHaveProperty("_pk");
        expect(result).not.toHaveProperty("_sk");
        expect(result).not.toHaveProperty("_table");

        const call = ddbMock.commandCalls(PutItemCommand)[0];
        expect(call.args[0].input.TableName).toBe("test-table");
    });

    it("should generate an id when none is provided", async () => {
        ddbMock.on(PutItemCommand).resolves({});

        const adapter = getAdapter();
        const result = await adapter.create({
            model: "user",
            data: { name: "Bob" },
        });

        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
    });
});

describe("findOne", () => {
    it("should use GetItem for single id lookup", async () => {
        ddbMock.on(GetItemCommand).resolves({
            Item: marshall({
                _pk: "user#123",
                _sk: "user#123",
                _table: "user",
                id: "123",
                name: "Alice",
            }),
        });

        const adapter = getAdapter();
        const result = await adapter.findOne({
            model: "user",
            where: [{ field: "id", operator: "eq", value: "123" }],
        });

        expect(result).toEqual({ id: "123", name: "Alice" });
        expect(ddbMock.commandCalls(GetItemCommand)).toHaveLength(1);
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it("should return null when item not found", async () => {
        ddbMock.on(GetItemCommand).resolves({ Item: undefined });

        const adapter = getAdapter();
        const result = await adapter.findOne({
            model: "user",
            where: [{ field: "id", operator: "eq", value: "nonexistent" }],
        });

        expect(result).toBeNull();
    });

    it("should fall back to query for non-id lookups", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({
                    _pk: "user#123",
                    _sk: "user#123",
                    _table: "user",
                    id: "123",
                    email: "alice@test.com",
                }),
            ],
        });

        const adapter = getAdapter();
        const result = await adapter.findOne({
            model: "user",
            where: [{ field: "email", operator: "eq", value: "alice@test.com" }],
        });

        expect(result).toEqual({ id: "123", email: "alice@test.com" });
        expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    });
});

describe("findMany", () => {
    it("should return all matching items", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2", name: "Bob" }),
            ],
        });

        const adapter = getAdapter();
        const results = await adapter.findMany({ model: "user", limit: 10 });

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe("Alice");
        expect(results[1].name).toBe("Bob");
    });

    it("should apply limit", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2", name: "Bob" }),
                marshall({ _pk: "user#3", _sk: "user#3", _table: "user", id: "3", name: "Charlie" }),
            ],
        });

        const adapter = getAdapter();
        const results = await adapter.findMany({ model: "user", limit: 2 });

        expect(results).toHaveLength(2);
    });

    it("should apply offset", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2", name: "Bob" }),
            ],
        });

        const adapter = getAdapter();
        const results = await adapter.findMany({ model: "user", limit: 10, offset: 1 });

        expect(results).toHaveLength(1);
        expect(results[0].name).toBe("Bob");
    });

    it("should sort ascending", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2", name: "Bob" }),
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
            ],
        });

        const adapter = getAdapter();
        const results = await adapter.findMany({
            model: "user",
            limit: 10,
            sortBy: { field: "name", direction: "asc" },
        });

        expect(results[0].name).toBe("Alice");
        expect(results[1].name).toBe("Bob");
    });

    it("should sort descending", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2", name: "Bob" }),
            ],
        });

        const adapter = getAdapter();
        const results = await adapter.findMany({
            model: "user",
            limit: 10,
            sortBy: { field: "name", direction: "desc" },
        });

        expect(results[0].name).toBe("Bob");
        expect(results[1].name).toBe("Alice");
    });
});

describe("update", () => {
    it("should update an existing item", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
            ],
        });
        ddbMock.on(UpdateItemCommand).resolves({});

        const adapter = getAdapter();
        const result = await adapter.update({
            model: "user",
            where: [{ field: "id", operator: "eq", value: "1" }],
            update: { name: "Alice Updated" },
        });

        expect(result?.name).toBe("Alice Updated");
        expect(ddbMock.commandCalls(UpdateItemCommand)).toHaveLength(1);
    });

    it("should return null when no item matches", async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const adapter = getAdapter();
        const result = await adapter.update({
            model: "user",
            where: [{ field: "id", operator: "eq", value: "nonexistent" }],
            update: { name: "test" },
        });

        expect(result).toBeNull();
    });
});

describe("updateMany", () => {
    it("should update multiple items and return count", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2", name: "Bob" }),
            ],
        });
        ddbMock.on(UpdateItemCommand).resolves({});

        const adapter = getAdapter();
        const count = await adapter.updateMany({
            model: "user",
            where: [{ field: "name", operator: "contains", value: "" }],
            update: { verified: "true" },
        });

        expect(count).toBe(2);
        expect(ddbMock.commandCalls(UpdateItemCommand)).toHaveLength(2);
    });
});

describe("delete", () => {
    it("should delete the first matching item", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1", name: "Alice" }),
            ],
        });
        ddbMock.on(DeleteItemCommand).resolves({});

        const adapter = getAdapter();
        await adapter.delete({
            model: "user",
            where: [{ field: "id", operator: "eq", value: "1" }],
        });

        expect(ddbMock.commandCalls(DeleteItemCommand)).toHaveLength(1);
    });

    it("should do nothing when no item matches", async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const adapter = getAdapter();
        await adapter.delete({
            model: "user",
            where: [{ field: "id", operator: "eq", value: "nonexistent" }],
        });

        expect(ddbMock.commandCalls(DeleteItemCommand)).toHaveLength(0);
    });
});

describe("deleteMany", () => {
    it("should delete all matching items and return count", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "session#1", _sk: "session#1", _table: "session", id: "1" }),
                marshall({ _pk: "session#2", _sk: "session#2", _table: "session", id: "2" }),
            ],
        });
        ddbMock.on(DeleteItemCommand).resolves({});

        const adapter = getAdapter();
        const count = await adapter.deleteMany({
            model: "session",
            where: [{ field: "userId", operator: "eq", value: "user-1" }],
        });

        expect(count).toBe(2);
        expect(ddbMock.commandCalls(DeleteItemCommand)).toHaveLength(2);
    });
});

describe("count", () => {
    it("should return the number of matching items", async () => {
        ddbMock.on(QueryCommand).resolves({
            Items: [
                marshall({ _pk: "user#1", _sk: "user#1", _table: "user", id: "1" }),
                marshall({ _pk: "user#2", _sk: "user#2", _table: "user", id: "2" }),
                marshall({ _pk: "user#3", _sk: "user#3", _table: "user", id: "3" }),
            ],
        });

        const adapter = getAdapter();
        const result = await adapter.count({ model: "user" });

        expect(result).toBe(3);
    });

    it("should return 0 when no items match", async () => {
        ddbMock.on(QueryCommand).resolves({ Items: [] });

        const adapter = getAdapter();
        const result = await adapter.count({ model: "user" });

        expect(result).toBe(0);
    });
});
