import { Api } from "grammy"
import { Effect, Schema } from "effect"

/**
 * Talking to Telegram at all: the client, the wrapper every call goes through,
 * and the one failure they share.
 *
 * Its own module rather than part of `provisioning.ts` because five modules now
 * make Telegram calls — provisioning, the BotFather fallback, the health sweep,
 * the bot registry, and the coach's photo import (#225) — and a primitive owned
 * by one of them is a primitive the others reach across the graph for. Here it
 * belongs to none of them, and the module graph stays a tree.
 */

export class TelegramSetupFailed extends Schema.TaggedErrorClass<TelegramSetupFailed>()(
  "BotWorker.TelegramSetupFailed",
  { operation: Schema.String },
) {}

/**
 * Every Telegram call the provisioning paths make. The cause is dropped on
 * purpose: a grammY failure carries the request URL, and for a coach bot that
 * URL carries its token (ADR 0004).
 */
export const telegram = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new TelegramSetupFailed({ operation }),
  })

export const apiFor = (token: string, fetch?: typeof globalThis.fetch): Api =>
  new Api(token, fetch === undefined ? undefined : { fetch })
