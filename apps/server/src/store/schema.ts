import { exec } from "./client.ts";
export const DEFAULT_RETENTION_DAYS = 30;
const MAX_MERGED_PART_BYTES = 64 * 1024 * 1024;
const DDL: string[] = [
    `CREATE TABLE IF NOT EXISTS activity (
     session_id   String,
     episode_id   UInt32,
     ts           DateTime64(3),
     kind         LowCardinality(String),
     type         LowCardinality(String),
     dir          LowCardinality(String),
     activity_key String,
     game         LowCardinality(String),
     payload      String CODEC(ZSTD(3)),
     ingested_at  DateTime64(3) DEFAULT now64(3)
   ) ENGINE = MergeTree
     PARTITION BY toYYYYMMDD(ts)
     ORDER BY (session_id, ts, activity_key)
     TTL ts + INTERVAL ${DEFAULT_RETENTION_DAYS} DAY DELETE
     SETTINGS max_bytes_to_merge_at_max_space_in_pool = ${MAX_MERGED_PART_BYTES}`,
    `CREATE TABLE IF NOT EXISTS sessions (
     session_id String,
     game       LowCardinality(String),
     origin     String,
     url        String,
     first_seen DateTime64(3),
     last_seen  DateTime64(3),
     version    UInt64
   ) ENGINE = ReplacingMergeTree(version)
     ORDER BY session_id`,
    `CREATE TABLE IF NOT EXISTS episodes (
     session_id      String,
     episode_id      UInt32,
     connected_at    DateTime64(3),
     disconnected_at Nullable(DateTime64(3)),
     version         UInt64
   ) ENGINE = ReplacingMergeTree(version)
     ORDER BY (session_id, episode_id)`,
    `CREATE TABLE IF NOT EXISTS config (
     session_id String,
     kind       LowCardinality(String),
     id         String,
     body       String,
     deleted    UInt8 DEFAULT 0,
     version    UInt64
   ) ENGINE = ReplacingMergeTree(version)
     ORDER BY (session_id, kind, id)`,
    `CREATE TABLE IF NOT EXISTS gaps (
     session_id    String,
     from_ts       DateTime64(3),
     to_ts         DateTime64(3),
     dropped_count UInt32,
     reason        LowCardinality(String),
     recorded_at   DateTime64(3) DEFAULT now64(3)
   ) ENGINE = MergeTree
     PARTITION BY toYYYYMMDD(from_ts)
     ORDER BY (session_id, from_ts)
     TTL from_ts + INTERVAL ${DEFAULT_RETENTION_DAYS} DAY DELETE`,
];
export async function applySchema(): Promise<void> {
    for (const ddl of DDL)
        await exec(ddl);
}
