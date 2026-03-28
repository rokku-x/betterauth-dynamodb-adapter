import { createAdapterFactory } from "better-auth/adapters";
import type { CleanedWhere } from "better-auth/adapters";
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand, } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

interface DynamoDBAdapterConfig {
    tableName: string;
    region: string;
}

/**
 * DynamoDB adapter for better-auth
 * @param config - The configuration for the adapter
 * @returns The adapter functions
 */
const dynamoDBAdapter = (config: DynamoDBAdapterConfig) => {
    const { tableName, region } = config;
    const client = new DynamoDBClient({ region });

    function strip(raw: Record<string, any>): Record<string, any> {
        const { _pk, _sk, _table, ...rest } = raw;
        return rest;
    }

    function buildFilter(where: CleanedWhere[]) {
        const parts: string[] = [];
        const vals: Record<string, any> = {};
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
                    const arr = w.value as any[];
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

    async function query(
        model: string,
        where?: CleanedWhere[],
    ): Promise<Record<string, any>[]> {
        const keyNames: Record<string, string> = { "#_table": "_table" };
        const keyVals: Record<string, any> = { ":_table": model };
        let filterExpr: string | undefined;
        let allNames = keyNames;
        let allVals = keyVals;

        if (where && where.length > 0) {
            const f = buildFilter(where);
            filterExpr = f.expression;
            allNames = { ...keyNames, ...f.names };
            allVals = { ...keyVals, ...f.vals };
        }

        const res = await client.send(
            new QueryCommand({
                TableName: tableName,
                IndexName: "_table-index",
                KeyConditionExpression: "#_table = :_table",
                FilterExpression: filterExpr,
                ExpressionAttributeNames: allNames,
                ExpressionAttributeValues: marshall(allVals),
            }),
        );

        return (res.Items || []).map((i) => strip(unmarshall(i)));
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
            create: async <T extends Record<string, any>>({
                model,
                data,
            }: {
                model: string;
                data: T;
                select?: string[];
            }): Promise<T> => {
                const id = (data as any).id || crypto.randomUUID();
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
                    }),
                );

                return { ...data, id } as T;
            },

            findOne: async <T>({
                model,
                where,
            }: {
                model: string;
                where: CleanedWhere[];
                select?: string[];
            }): Promise<T | null> => {
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
                        }),
                    );
                    if (!res.Item) return null;
                    return strip(unmarshall(res.Item)) as T;
                }

                const items = await query(model, where);
                return (items[0] as T) || null;
            },

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
                let items = await query(model, where);

                if (sortBy) {
                    const dir = sortBy.direction === "desc" ? -1 : 1;
                    items.sort((a, b) => {
                        if (a[sortBy.field] < b[sortBy.field]) return -1 * dir;
                        if (a[sortBy.field] > b[sortBy.field]) return 1 * dir;
                        return 0;
                    });
                }
                if (offset) items = items.slice(offset);
                if (limit) items = items.slice(0, limit);

                return items as T[];
            },

            update: async <T>({
                model,
                where,
                update: updateData,
            }: {
                model: string;
                where: CleanedWhere[];
                update: T;
            }): Promise<T | null> => {
                const items = await query(model, where);
                if (items.length === 0) return null;

                const existing = items[0];
                const id = existing.id;
                const entries = Object.entries(updateData as Record<string, any>);
                const exprs: string[] = [];
                const vals: Record<string, any> = {};
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
                    }),
                );

                return { ...existing, ...(updateData as Record<string, any>) } as unknown as T;
            },

            updateMany: async ({
                model,
                where,
                update: updateData,
            }: {
                model: string;
                where: CleanedWhere[];
                update: Record<string, any>;
            }): Promise<number> => {
                const items = await query(model, where);
                let count = 0;

                for (const item of items) {
                    const entries = Object.entries(updateData);
                    const exprs: string[] = [];
                    const vals: Record<string, any> = {};
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
                        }),
                    );
                    count++;
                }

                return count;
            },

            delete: async ({
                model,
                where,
            }: {
                model: string;
                where: CleanedWhere[];
            }): Promise<void> => {
                const items = await query(model, where);
                if (items.length === 0) return;

                await client.send(
                    new DeleteItemCommand({
                        TableName: tableName,
                        Key: marshall({
                            _pk: `${model}#${items[0].id}`,
                            _sk: `${model}#${items[0].id}`,
                        }),
                    }),
                );
            },

            deleteMany: async ({
                model,
                where,
            }: {
                model: string;
                where: CleanedWhere[];
            }): Promise<number> => {
                const items = await query(model, where);
                for (const item of items) {
                    await client.send(
                        new DeleteItemCommand({
                            TableName: tableName,
                            Key: marshall({
                                _pk: `${model}#${item.id}`,
                                _sk: `${model}#${item.id}`,
                            }),
                        }),
                    );
                }
                return items.length;
            },

            count: async ({
                model,
                where,
            }: {
                model: string;
                where?: CleanedWhere[];
            }): Promise<number> => {
                const items = await query(model, where);
                return items.length;
            },
        }),
    });
};

export default dynamoDBAdapter