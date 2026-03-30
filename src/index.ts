import { createAdapterFactory } from "better-auth/adapters";
import type { CleanedWhere } from "better-auth/adapters";
import {
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
    DeleteItemCommand,
    QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

type AWSRegion =
    | "us-east-1"
    | "us-east-2"
    | "us-west-1"
    | "us-west-2"
    | "eu-west-1"
    | "eu-west-2"
    | "eu-west-3"
    | "eu-central-1"
    | "eu-north-1"
    | "ap-northeast-1"
    | "ap-northeast-2"
    | "ap-northeast-3"
    | "ap-southeast-1"
    | "ap-southeast-2"
    | "ap-south-1"
    | "ca-central-1"
    | "sa-east-1"
    | "me-south-1"
    | "af-south-1"
    | "ap-east-1";

interface DynamoDBAdapterConfig {
    tableName: string;
    region: AWSRegion;
}

/**
 * Custom error class for DynamoDB adapter operations
 */
class DynamoDBAdapterError extends Error {
    constructor(message: string, public readonly operation: string) {
        super(message);
        this.name = "DynamoDBAdapterError";
    }
}

/**
 * DynamoDB adapter for better-auth
 *
 * @param config - The configuration for the adapter
 * @param config.tableName - The DynamoDB table name (must not be empty)
 * @param config.region - The AWS region (must be a valid AWS region)
 * @returns The adapter factory with CRUD operations
 *
 * @example
 * ```ts
 * const adapter = dynamoDBAdapter({
 *   tableName: "my-auth-table",
 *   region: "us-east-1",
 * });
 * ```
 */
const DynamoDBAdapter = (config: DynamoDBAdapterConfig) => {
    // Validate configuration
    if (!config.tableName || config.tableName.trim().length === 0) {
        throw new DynamoDBAdapterError(
            "tableName must not be empty",
            "initialization"
        );
    }

    const { tableName, region } = config;
    const client = new DynamoDBClient({ region });

    /**
     * Removes internal DynamoDB attributes from an item
     * @param raw - The raw item from DynamoDB
     * @returns The item without internal attributes (_pk, _sk, _table)
     */
    function strip(raw: Record<string, unknown>): Record<string, unknown> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _pk, _sk, _table, ...rest } = raw;
        return rest;
    }

    /**
     * Builds a DynamoDB filter expression from where conditions
     * @param where - Array of filter conditions
     * @returns Object containing expression, values, and attribute names
     * @throws {DynamoDBAdapterError} If where array is empty
     */
    function buildFilter(where: CleanedWhere[]) {
        if (!where || where.length === 0) {
            throw new DynamoDBAdapterError(
                "where conditions cannot be empty",
                "buildFilter"
            );
        }
        const parts: string[] = [];
        const vals: Record<string, unknown> = {};
        const names: Record<string, string> = {};

        where.forEach((w, i) => {
            const nk = `#w${i}`;
            const vk = `:w${i}`;
            names[nk] = w.field;

            let expr: string;
            switch (w.operator) {
                case "ne":
                    vals[vk] = w.value;
                    expr = `${nk} <> ${vk}`;
                    break;
                case "gt":
                    vals[vk] = w.value;
                    expr = `${nk} > ${vk}`;
                    break;
                case "gte":
                    vals[vk] = w.value;
                    expr = `${nk} >= ${vk}`;
                    break;
                case "lt":
                    vals[vk] = w.value;
                    expr = `${nk} < ${vk}`;
                    break;
                case "lte":
                    vals[vk] = w.value;
                    expr = `${nk} <= ${vk}`;
                    break;
                case "in":
                case "not_in": {
                    const arr = w.value as unknown[];
                    if (!Array.isArray(arr) || arr.length === 0) {
                        throw new DynamoDBAdapterError(
                            `${w.operator} operator requires non-empty array`,
                            "buildFilter"
                        );
                    }
                    const keys = arr.map((_, j) => `:w${i}_${j}`);
                    arr.forEach((v, j) => {
                        vals[`:w${i}_${j}`] = v;
                    });
                    const inExpr = `${nk} IN (${keys.join(",")})`;
                    expr =
                        w.operator === "not_in"
                            ? `NOT ${inExpr}`
                            : inExpr;
                    break;
                }
                case "contains":
                    vals[vk] = w.value;
                    expr = `contains(${nk}, ${vk})`;
                    break;
                case "starts_with":
                    vals[vk] = w.value;
                    expr = `begins_with(${nk}, ${vk})`;
                    break;
                case "ends_with":
                    vals[vk] = w.value;
                    expr = `contains(${nk}, ${vk})`;
                    break;
                default:
                    vals[vk] = w.value;
                    expr = `${nk} = ${vk}`;
                    break;
            }

            if (i > 0) {
                parts.push(w.connector === "OR" ? "OR" : "AND");
            }
            parts.push(expr);
        });

        return { expression: parts.join(" "), vals, names };
    }

    /**
     * Queries items from DynamoDB by model type with optional filtering
     * @param model - The model name to query
     * @param where - Optional filter conditions
     * @returns Array of items matching the query
     * @throws {DynamoDBAdapterError} If DynamoDB operation fails
     */
    async function query(
        model: string,
        where?: CleanedWhere[]
    ): Promise<Record<string, unknown>[]> {
        if (!model || model.trim().length === 0) {
            throw new DynamoDBAdapterError("model must not be empty", "query");
        }

        const keyNames: Record<string, string> = { "#_table": "_table" };
        const keyVals: Record<string, unknown> = { ":_table": model };
        let filterExpr: string | undefined;
        let allNames = keyNames;
        let allVals = keyVals;

        if (where && where.length > 0) {
            const f = buildFilter(where);
            filterExpr = f.expression;
            allNames = { ...keyNames, ...f.names };
            allVals = { ...keyVals, ...f.vals };
        }

        try {
            const res = await client.send(
                new QueryCommand({
                    TableName: tableName,
                    IndexName: "_table-index",
                    KeyConditionExpression: "#_table = :_table",
                    FilterExpression: filterExpr,
                    ExpressionAttributeNames: allNames,
                    ExpressionAttributeValues: marshall(allVals),
                })
            );

            return (res.Items || []).map((i) => strip(unmarshall(i)));
        } catch (error) {
            throw new DynamoDBAdapterError(
                `Failed to query model "${model}": ${error instanceof Error ? error.message : String(error)}`,
                "query"
            );
        }
    }

    return createAdapterFactory({
        config: {
            adapterId: "dynamodb",
            adapterName: "DynamoDB Adapter",
            supportsJSON: false,
            supportsDates: false,
            supportsBooleans: false,
            supportsNumericIds: false,
        },
        adapter: () => ({
            /**
             * Creates a new item in the database
             * @param model - The model name
             * @param data - The item data to create
             * @returns The created item with generated ID
             * @throws {DynamoDBAdapterError} If creation fails
             */
            create: async <T extends Record<string, unknown>>({
                model,
                data,
            }: {
                model: string;
                data: T;
                select?: string[];
            }): Promise<T> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "create");
                }
                if (!data || typeof data !== "object") {
                    throw new DynamoDBAdapterError("data must be a valid object", "create");
                }

                try {
                    const id = (data as Record<string, unknown>).id || crypto.randomUUID();
                    const item = {
                        ...data,
                        id,
                        _pk: `${model}#${id}`,
                        _sk: `${model}#${id}`,
                        _table: model,
                    };

                    await client.send(
                        new PutItemCommand({
                            TableName: tableName,
                            Item: marshall(item, { removeUndefinedValues: true }),
                        })
                    );

                    return { ...data, id } as T;
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to create item: ${error instanceof Error ? error.message : String(error)}`,
                        "create"
                    );
                }
            },

            /**
             * Finds a single item by conditions
             * @param model - The model name
             * @param where - Filter conditions
             * @returns The matching item or null if not found
             * @throws {DynamoDBAdapterError} If query fails
             */
            findOne: async <T>({
                model,
                where,
            }: {
                model: string;
                where: CleanedWhere[];
                select?: string[];
            }): Promise<T | null> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "findOne");
                }
                if (!where || where.length === 0) {
                    throw new DynamoDBAdapterError(
                        "where conditions are required",
                        "findOne"
                    );
                }

                try {
                    if (
                        where.length === 1 &&
                        where[0].field === "id" &&
                        where[0].operator === "eq"
                    ) {
                        const id = where[0].value as string;
                        const res = await client.send(
                            new GetItemCommand({
                                TableName: tableName,
                                Key: marshall({
                                    _pk: `${model}#${id}`,
                                    _sk: `${model}#${id}`,
                                }),
                            })
                        );
                        if (!res.Item) return null;
                        return strip(unmarshall(res.Item)) as T;
                    }

                    const items = await query(model, where);
                    return (items[0] as T) || null;
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to find item: ${error instanceof Error ? error.message : String(error)}`,
                        "findOne"
                    );
                }
            },

            /**
             * Finds multiple items with optional sorting and pagination
             * @param model - The model name
             * @param where - Optional filter conditions
             * @param limit - Maximum number of items to return
             * @param sortBy - Optional sorting configuration
             * @param offset - Optional pagination offset
             * @returns Array of matching items
             * @throws {DynamoDBAdapterError} If query fails
             */
            findMany: async <T>({
                model,
                where,
                limit,
                sortBy,
                offset,
            }: {
                model: string;
                where?: CleanedWhere[];
                limit: number;
                sortBy?: { field: string; direction: "asc" | "desc" };
                offset?: number;
            }): Promise<T[]> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "findMany");
                }
                if (limit < 0) {
                    throw new DynamoDBAdapterError("limit must be non-negative", "findMany");
                }
                if (offset !== undefined && offset < 0) {
                    throw new DynamoDBAdapterError("offset must be non-negative", "findMany");
                }

                try {
                    let items = await query(model, where);

                    if (sortBy) {
                        const dir = sortBy.direction === "desc" ? -1 : 1;
                        items.sort((a, b) => {
                            const aVal = a[sortBy.field];
                            const bVal = b[sortBy.field];
                            if (aVal === undefined || aVal === null || bVal === undefined || bVal === null) return 0;
                            if (aVal < bVal) return -1 * dir;
                            if (aVal > bVal) return 1 * dir;
                            return 0;
                        });
                    }
                    if (offset) items = items.slice(offset);
                    if (limit) items = items.slice(0, limit);

                    return items as T[];
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to find items: ${error instanceof Error ? error.message : String(error)}`,
                        "findMany"
                    );
                }
            },

            /**
             * Updates a single item
             * @param model - The model name
             * @param where - Filter conditions to find the item
             * @param update - Fields to update
             * @returns The updated item or null if not found
             * @throws {DynamoDBAdapterError} If update fails
             */
            update: async <T>({
                model,
                where,
                update: updateData,
            }: {
                model: string;
                where: CleanedWhere[];
                update: T;
            }): Promise<T | null> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "update");
                }
                if (!where || where.length === 0) {
                    throw new DynamoDBAdapterError(
                        "where conditions are required",
                        "update"
                    );
                }
                if (!updateData || typeof updateData !== "object") {
                    throw new DynamoDBAdapterError(
                        "update data must be a valid object",
                        "update"
                    );
                }

                try {
                    const items = await query(model, where);
                    if (items.length === 0) return null;

                    const existing = items[0];
                    const id = existing.id;
                    const entries = Object.entries(updateData as Record<string, unknown>);
                    const exprs: string[] = [];
                    const vals: Record<string, unknown> = {};
                    const names: Record<string, string> = {};

                    entries.forEach(([key, value], idx) => {
                        if (key === "id" || key.startsWith("_")) return;
                        exprs.push(`#u${idx} = :u${idx}`);
                        names[`#u${idx}`] = key;
                        vals[`:u${idx}`] = value;
                    });

                    if (exprs.length === 0) return existing as unknown as T;

                    await client.send(
                        new UpdateItemCommand({
                            TableName: tableName,
                            Key: marshall({
                                _pk: `${model}#${id}`,
                                _sk: `${model}#${id}`,
                            }),
                            UpdateExpression: `SET ${exprs.join(", ")}`,
                            ExpressionAttributeNames: names,
                            ExpressionAttributeValues: marshall(vals, {
                                removeUndefinedValues: true,
                            }),
                        })
                    );

                    return { ...existing, ...(updateData as Record<string, unknown>) } as unknown as T;
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to update item: ${error instanceof Error ? error.message : String(error)}`,
                        "update"
                    );
                }
            },

            /**
             * Updates multiple items matching conditions
             * @param model - The model name
             * @param where - Filter conditions
             * @param update - Fields to update
             * @returns Number of items updated
             * @throws {DynamoDBAdapterError} If update fails
             */
            updateMany: async ({
                model,
                where,
                update: updateData,
            }: {
                model: string;
                where: CleanedWhere[];
                update: Record<string, unknown>;
            }): Promise<number> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "updateMany");
                }
                if (!where || where.length === 0) {
                    throw new DynamoDBAdapterError(
                        "where conditions are required",
                        "updateMany"
                    );
                }

                try {
                    const items = await query(model, where);
                    let count = 0;

                    for (const item of items) {
                        const entries = Object.entries(updateData);
                        const exprs: string[] = [];
                        const vals: Record<string, unknown> = {};
                        const names: Record<string, string> = {};

                        entries.forEach(([key, value], idx) => {
                            if (key === "id" || key.startsWith("_")) return;
                            exprs.push(`#u${idx} = :u${idx}`);
                            names[`#u${idx}`] = key;
                            vals[`:u${idx}`] = value;
                        });

                        if (exprs.length === 0) continue;

                        await client.send(
                            new UpdateItemCommand({
                                TableName: tableName,
                                Key: marshall({
                                    _pk: `${model}#${item.id}`,
                                    _sk: `${model}#${item.id}`,
                                }),
                                UpdateExpression: `SET ${exprs.join(", ")}`,
                                ExpressionAttributeNames: names,
                                ExpressionAttributeValues: marshall(vals, {
                                    removeUndefinedValues: true,
                                }),
                            })
                        );
                        count++;
                    }

                    return count;
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to update items: ${error instanceof Error ? error.message : String(error)}`,
                        "updateMany"
                    );
                }
            },

            /**
             * Deletes a single item
             * @param model - The model name
             * @param where - Filter conditions to find the item
             * @throws {DynamoDBAdapterError} If delete fails
             */
            delete: async ({
                model,
                where,
            }: {
                model: string;
                where: CleanedWhere[];
            }): Promise<void> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "delete");
                }
                if (!where || where.length === 0) {
                    throw new DynamoDBAdapterError(
                        "where conditions are required",
                        "delete"
                    );
                }

                try {
                    const items = await query(model, where);
                    if (items.length === 0) return;

                    await client.send(
                        new DeleteItemCommand({
                            TableName: tableName,
                            Key: marshall({
                                _pk: `${model}#${items[0].id}`,
                                _sk: `${model}#${items[0].id}`,
                            }),
                        })
                    );
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to delete item: ${error instanceof Error ? error.message : String(error)}`,
                        "delete"
                    );
                }
            },

            /**
             * Deletes multiple items matching conditions
             * @param model - The model name
             * @param where - Filter conditions
             * @returns Number of items deleted
             * @throws {DynamoDBAdapterError} If delete fails
             */
            deleteMany: async ({
                model,
                where,
            }: {
                model: string;
                where: CleanedWhere[];
            }): Promise<number> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "deleteMany");
                }
                if (!where || where.length === 0) {
                    throw new DynamoDBAdapterError(
                        "where conditions are required",
                        "deleteMany"
                    );
                }

                try {
                    const items = await query(model, where);
                    for (const item of items) {
                        await client.send(
                            new DeleteItemCommand({
                                TableName: tableName,
                                Key: marshall({
                                    _pk: `${model}#${item.id}`,
                                    _sk: `${model}#${item.id}`,
                                }),
                            })
                        );
                    }
                    return items.length;
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to delete items: ${error instanceof Error ? error.message : String(error)}`,
                        "deleteMany"
                    );
                }
            },

            /**
             * Counts items matching conditions
             * @param model - The model name
             * @param where - Optional filter conditions
             * @returns Number of matching items
             * @throws {DynamoDBAdapterError} If count fails
             */
            count: async ({
                model,
                where,
            }: {
                model: string;
                where?: CleanedWhere[];
            }): Promise<number> => {
                if (!model || model.trim().length === 0) {
                    throw new DynamoDBAdapterError("model must not be empty", "count");
                }

                try {
                    const items = await query(model, where);
                    return items.length;
                } catch (error) {
                    throw new DynamoDBAdapterError(
                        `Failed to count items: ${error instanceof Error ? error.message : String(error)}`,
                        "count"
                    );
                }
            },
        }),
    });
};

export default DynamoDBAdapter;