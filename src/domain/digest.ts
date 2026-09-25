import { createHash } from "node:crypto";

/**
 * 稳定内容摘要，取 SHA-256 的前 128 位（32 个十六进制字符）。
 *
 * 此前用的是 32 位 FNV-1a。它同时充当 `news_documents` 的主键与 AI 分析缓存键：
 * 按 30 天保留期与东财快讯约 30 条/分钟估算，累计约 1.5 万份文档时，至少发生一次
 * 碰撞的概率约 2–3%/月，而碰撞会让两条无关文档静默合并成一行（其中一条被覆盖丢失）。
 * 128 位下该概率可忽略。
 *
 * 注意：本模块使用 node:crypto，只能用于主进程代码，不要被渲染器入口引用。
 */
export function stableDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
