import mongoose from "mongoose";
import { MONGODB_URI } from "./env";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};
const g = globalThis as unknown as { mongooseCache?: MongooseCache };
const cached: MongooseCache = g.mongooseCache || { conn: null, promise: null };

if (!g.mongooseCache) {
  g.mongooseCache = cached;
}

export async function connectMongo() {
  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI");
  }
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
