import { Schema, SchemaGetter } from "effect"

export const WorkspaceNameMaxLength = 64
export const WorkspaceDescriptionMaxLength = 512
export const WorkspaceShortDescriptionMaxLength = 120

export const CreateWorkspaceRequestId = Schema.String.check(Schema.isUUID(4))
/** Idempotency for a workspace rename — the same shape the create path uses. */
export const WorkspaceRenameRequestId = CreateWorkspaceRequestId

export const CoachLanguage = Schema.Literals(["en", "uk", "ru"])
export type CoachLanguage = typeof CoachLanguage.Type

const WorkspaceName = Schema.Trim.check(Schema.isMinLength(1)).check(
  Schema.isMaxLength(WorkspaceNameMaxLength),
)

const RawOptionalDescription = Schema.optionalKey(
  Schema.Trim.check(Schema.isMaxLength(WorkspaceDescriptionMaxLength)),
)

const RawOptionalShortDescription = Schema.optionalKey(
  Schema.Trim.check(Schema.isMaxLength(WorkspaceShortDescriptionMaxLength)),
)

const NonEmptyDescription = Schema.Trim.check(Schema.isMinLength(1)).check(
  Schema.isMaxLength(WorkspaceDescriptionMaxLength),
)

const NonEmptyShortDescription = Schema.Trim.check(Schema.isMinLength(1)).check(
  Schema.isMaxLength(WorkspaceShortDescriptionMaxLength),
)

// Creation asks for nothing but an optional internal label: the coach owns
// their profile (language, descriptions) and sets it during onboarding (#103).
const RawCreateWorkspaceInput = Schema.Struct({
  requestId: CreateWorkspaceRequestId,
  name: Schema.optionalKey(Schema.Trim.check(Schema.isMaxLength(WorkspaceNameMaxLength))),
  coachLanguage: Schema.optionalKey(CoachLanguage),
  description: RawOptionalDescription,
  shortDescription: RawOptionalShortDescription,
})

const NormalizedCreateWorkspaceInput = Schema.Struct({
  requestId: CreateWorkspaceRequestId,
  name: Schema.optionalKey(WorkspaceName),
  coachLanguage: Schema.optionalKey(CoachLanguage),
  description: Schema.optionalKey(NonEmptyDescription),
  shortDescription: Schema.optionalKey(NonEmptyShortDescription),
})

export const CreateWorkspaceInput = RawCreateWorkspaceInput.pipe(
  Schema.decodeTo(NormalizedCreateWorkspaceInput, {
    decode: SchemaGetter.transform((input) => ({
      requestId: input.requestId,
      ...(input.name === undefined || input.name.length === 0 ? {} : { name: input.name }),
      ...(input.coachLanguage === undefined ? {} : { coachLanguage: input.coachLanguage }),
      ...(input.description === undefined || input.description.length === 0
        ? {}
        : { description: input.description }),
      ...(input.shortDescription === undefined || input.shortDescription.length === 0
        ? {}
        : { shortDescription: input.shortDescription }),
    })),
    encode: SchemaGetter.transform((input) => input),
  }),
)

export type CreateWorkspaceInput = typeof CreateWorkspaceInput.Type

/** Channels an invite can leave through. Email ships later (#105). */
export const InviteDeliveryChannel = Schema.Literals(["telegram", "email", "copy"])
export type InviteDeliveryChannel = typeof InviteDeliveryChannel.Type

/**
 * The delivery action accompanying a lazy create. `language` is the language of
 * the invite *message* (default English in the UI) — never a property of the
 * coach. Only the channels deliverable today are accepted.
 */
export const CreateInviteDelivery = Schema.Struct({
  channel: Schema.Literals(["telegram", "copy"]),
  language: CoachLanguage,
})
export type CreateInviteDelivery = typeof CreateInviteDelivery.Type

/** What the invite row remembers about its last delivery, for the pending card and Resend. */
export const InviteDeliveryRecord = Schema.Struct({
  channel: InviteDeliveryChannel,
  destination: Schema.optionalKey(Schema.NonEmptyString),
  language: CoachLanguage,
})
export type InviteDeliveryRecord = typeof InviteDeliveryRecord.Type

/**
 * The one thing the admin still edits on an existing workspace (#108): the
 * internal label. Branding — description, short description, avatar — belongs
 * to the coach, so it is not part of any admin write. `expectedUpdatedAt`
 * carries the optimistic-concurrency check the profile form used to carry.
 */
export const RenameWorkspaceInput = Schema.Struct({
  requestId: WorkspaceRenameRequestId,
  expectedUpdatedAt: Schema.DateTimeUtcFromString,
  name: WorkspaceName,
})

export type RenameWorkspaceInput = typeof RenameWorkspaceInput.Type
