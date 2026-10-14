import { parseEnv } from "@neon/env";
import config from "../../neon";
import { loadLocalEnv } from "./env";

loadLocalEnv();

function readDatabaseEnv() {
  return parseEnv(config, ["DATABASE_URL"]);
}

let databaseEnv: ReturnType<typeof readDatabaseEnv> | undefined;

export function neonEnv() {
  if (!databaseEnv) databaseEnv = readDatabaseEnv();
  return databaseEnv;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Object storage is not configured. Set ${name}.`);
  return value;
}

/** Netlify reserves AWS_* and injects its own values, so production uses NEON_STORAGE_*. */
export function storageEnv() {
  loadLocalEnv();
  if (process.env.NEON_STORAGE_ACCESS_KEY_ID) {
    return {
      accessKeyId: required("NEON_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: required("NEON_STORAGE_SECRET_ACCESS_KEY"),
      endpoint: required("NEON_STORAGE_ENDPOINT"),
      region: required("NEON_STORAGE_REGION"),
    };
  }
  return {
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
    endpoint: required("AWS_ENDPOINT_URL_S3"),
    region: required("AWS_REGION"),
  };
}
