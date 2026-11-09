import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { uploadDir } from "./uploads";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;

/** True for addresses an import must never reach (loopback, private, link-local, metadata, multicast, reserved). */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return isBlockedAddress(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}

/** Test-only escape hatch: lets the automated tests serve images from a local http server. Never set in production. */
const allowLocalForTests = () => process.env.NODE_ENV === "test" && process.env.IMAGE_FETCH_ALLOW_LOCAL === "1";

const safeLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return (cb as (e: Error | null, a?: string, f?: number) => void)(err);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad && !allowLocalForTests()) return (cb as (e: Error | null) => void)(new AppError("VALIDATION", "The image address points to a private or internal network and was blocked."));
    const first = list[0];
    if ((options as { all?: boolean })?.all) (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    else (cb as (e: null, a: string, f: number) => void)(null, first.address, first.family);
  });
};

function get(url: URL, redirects: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const isHttp = url.protocol === "http:";
    if (url.protocol !== "https:" && !(isHttp && allowLocalForTests())) return reject(new AppError("VALIDATION", "Image URLs must start with https://"));
    if (url.username || url.password) return reject(new AppError("VALIDATION", "Image URLs may not contain a user name or password."));
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, "")) && !allowLocalForTests()) {
      return reject(new AppError("VALIDATION", "The image address points to a private or internal network and was blocked."));
    }
    const req = (isHttp ? http : https).get(url, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "User-Agent": "NurseryPOS-image-import/1.0", Accept: "image/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) return reject(new AppError("VALIDATION", "The image link redirects too many times."));
        try { return resolve(get(new URL(res.headers.location, url), redirects + 1)); } catch { return reject(new AppError("VALIDATION", "The image link redirects to an invalid address.")); }
      }
      if (status !== 200) { res.resume(); return reject(new AppError("VALIDATION", `The image server answered ${status}.`)); }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > MAX_BYTES) { res.destroy(); return reject(new AppError("VALIDATION", "The image is larger than 5 MB.")); }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BYTES) { res.destroy(); reject(new AppError("VALIDATION", "The image is larger than 5 MB.")); } else chunks.push(c); });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => reject(new AppError("VALIDATION", "The image download was interrupted.")));
    });
    req.on("timeout", () => { req.destroy(); reject(new AppError("VALIDATION", "The image server took too long to answer.")); });
    req.on("error", (e) => reject(e instanceof AppError ? e : new AppError("VALIDATION", "The image could not be downloaded (address not reachable).")));
  });
}

export function imageExt(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Download a product photo safely and store it under a random name. Returns the stored file name. */
export async function fetchProductImage(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AppError("VALIDATION", "The image URL is not valid."); }
  const buf = await get(url, 0);
  const ext = imageExt(buf);
  if (!ext) throw new AppError("VALIDATION", "The link did not return a JPEG, PNG or WebP image.");
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), buf, { flag: "wx" });
  return name;
}
