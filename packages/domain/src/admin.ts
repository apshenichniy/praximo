import { Schema } from "effect"
import { TelegramId } from "./telegram-id.ts"

/**
 * The platform operator, keyed by Telegram id. It sits above tenancy — an admin
 * belongs to no workspace. In MVP the only way to become one is the db:reset
 * seed from the root `.env`; the shape is the one a future assignable role reuses
 * (admin-surface.md).
 */
export const AdminId = Schema.NonEmptyString.pipe(Schema.brand("AdminId"))

export type AdminId = typeof AdminId.Type

export const Admin = Schema.Struct({
  id: AdminId,
  telegramId: TelegramId,
})

export interface Admin extends Schema.Schema.Type<typeof Admin> {}

export class AdminNotFound extends Schema.TaggedErrorClass<AdminNotFound>()(
  "Domain.AdminNotFound",
  {
    telegramId: TelegramId,
  },
) {}
