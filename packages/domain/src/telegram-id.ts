import { Schema } from "effect"

/**
 * A Telegram user/chat id — a durable identity key in the domain (CONTEXT.md):
 * it keys the platform admin, a member's auth identity, and the telegram
 * channel. Branded so an unvalidated string can't stand in for one.
 */
export const TelegramId = Schema.NonEmptyString.pipe(Schema.brand("TelegramId"))

export type TelegramId = typeof TelegramId.Type
