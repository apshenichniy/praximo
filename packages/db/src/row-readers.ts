import type { CoachLanguage } from "@praximo/domain"
import { sql } from "drizzle-orm"

/**
 * Reading raw rows back, in one place because three repositories do it.
 *
 * `execute` hands back whatever the driver decoded rather than the typed
 * columns the query builder maps, so a statement that reaches for a CTE or a
 * lateral join has to say for itself what a timestamp and an enum are.
 */

/**
 * A timestamp as ISO text.
 *
 * Postgres's own `2026-07-26 09:00:00+00` is not a format `new Date` is
 * required to parse, so the conversion happens in SQL where it is explicit
 * rather than at the mercy of a parser's good will.
 */
export const isoColumn = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)

export const readDate = (value: unknown): Date | undefined =>
  typeof value === "string" ? new Date(value) : undefined

/** A language column narrowed to the three the product speaks. */
export const readLanguage = (value: unknown): CoachLanguage | undefined =>
  value === "en" || value === "uk" || value === "ru" ? value : undefined
