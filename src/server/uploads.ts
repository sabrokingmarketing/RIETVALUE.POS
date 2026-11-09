import "server-only";
import path from "node:path";

/** Directory for uploaded photos (persistent volume in production). */
export function uploadDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./uploads");
}
