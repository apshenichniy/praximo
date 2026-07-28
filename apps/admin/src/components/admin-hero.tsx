import { Heading, PraximoMark, Text } from "@praximo/ui"

export function AdminHero() {
  return (
    <header className="flex flex-col items-center text-center">
      <PraximoMark size={96} />
      <Heading as="h1" role="display" className="mt-7">
        Praximo Admin
      </Heading>
      <Text className="text-muted-foreground mt-3 max-w-sm text-pretty">
        Manage coach workspaces, Telegram bots, and onboarding.
      </Text>
    </header>
  )
}
