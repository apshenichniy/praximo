import { Schema, SchemaGetter } from "effect"

export const WorkspaceNameMaxLength = 64
export const WorkspaceDescriptionMaxLength = 512
export const WorkspaceShortDescriptionMaxLength = 120

export const CreateWorkspaceRequestId = Schema.String.check(Schema.isUUID(4))
export const WorkspaceProfileRequestId = CreateWorkspaceRequestId

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

const RawCreateWorkspaceInput = Schema.Struct({
  requestId: CreateWorkspaceRequestId,
  name: WorkspaceName,
  coachLanguage: CoachLanguage,
  description: RawOptionalDescription,
  shortDescription: RawOptionalShortDescription,
})

const NormalizedCreateWorkspaceInput = Schema.Struct({
  requestId: CreateWorkspaceRequestId,
  name: WorkspaceName,
  coachLanguage: CoachLanguage,
  description: Schema.optionalKey(NonEmptyDescription),
  shortDescription: Schema.optionalKey(NonEmptyShortDescription),
})

export const CreateWorkspaceInput = RawCreateWorkspaceInput.pipe(
  Schema.decodeTo(NormalizedCreateWorkspaceInput, {
    decode: SchemaGetter.transform((input) => ({
      requestId: input.requestId,
      name: input.name,
      coachLanguage: input.coachLanguage,
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

export const WorkspaceAvatarIntent = Schema.Literals(["keep", "replace", "reset"])
export type WorkspaceAvatarIntent = typeof WorkspaceAvatarIntent.Type

const RawUpdateWorkspaceProfileInput = Schema.Struct({
  requestId: WorkspaceProfileRequestId,
  expectedUpdatedAt: Schema.DateTimeUtcFromString,
  name: WorkspaceName,
  description: RawOptionalDescription,
  shortDescription: RawOptionalShortDescription,
  avatarIntent: WorkspaceAvatarIntent,
})

const NormalizedUpdateWorkspaceProfileInput = Schema.Struct({
  requestId: WorkspaceProfileRequestId,
  expectedUpdatedAt: Schema.DateTimeUtc,
  name: WorkspaceName,
  description: Schema.optionalKey(NonEmptyDescription),
  shortDescription: Schema.optionalKey(NonEmptyShortDescription),
  avatarIntent: WorkspaceAvatarIntent,
})

export const UpdateWorkspaceProfileInput = RawUpdateWorkspaceProfileInput.pipe(
  Schema.decodeTo(NormalizedUpdateWorkspaceProfileInput, {
    decode: SchemaGetter.transform((input) => ({
      requestId: input.requestId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      name: input.name,
      avatarIntent: input.avatarIntent,
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

export type UpdateWorkspaceProfileInput = typeof UpdateWorkspaceProfileInput.Type
