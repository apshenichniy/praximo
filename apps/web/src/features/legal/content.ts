import type { CoachLanguage } from "@praximo/domain"

/**
 * The two legal texts, as data.
 *
 * They live in the app rather than on a marketing page (privacy-retention.md):
 * a coach reading the terms is inside a Mini App, and a link that ejects them
 * into a browser mid-onboarding is a link they may not come back from.
 *
 * Structured rather than authored as TSX because two things have to be
 * mechanical: the version is derived from this content, so filling a placeholder
 * necessarily changes it (see `versions.ts`), and the placeholder registry is
 * checked against what the text actually contains rather than against a list
 * somebody remembered to update.
 *
 * English only in this slice. The `locale` parameter exists from day one so the
 * i18n foundation ticket can add `uk` and `ru` without re-authoring anything
 * that renders these — epic #35 wants three languages, and this is a recorded
 * deviation with a named payer, not a silent one.
 */
export type LegalLocale = CoachLanguage

/**
 * Everything still waiting on the legal-entity decision deferred in #6. Every
 * one of these appears in the texts below, and a test holds the two in step: a
 * marker nobody registered would otherwise ship as a launch blocker nobody knew
 * about.
 */
export const legalPlaceholders = {
  operator: "operator legal name and address",
  llmProviders: "LLM providers",
  pricing: "pricing terms",
  liabilityCap: "liability cap",
  jurisdiction: "jurisdiction",
  contactEmail: "contact email",
} as const

export type LegalPlaceholder = keyof typeof legalPlaceholders

/** A run of text. Anything but a plain string is rendered differently. */
export type LegalInline =
  | string
  | { readonly emphasis: string }
  | { readonly placeholder: LegalPlaceholder }
  | { readonly link: string; readonly to: string }

export type LegalBlock =
  | { readonly kind: "paragraph"; readonly content: ReadonlyArray<LegalInline> }
  | { readonly kind: "list"; readonly items: ReadonlyArray<ReadonlyArray<LegalInline>> }
  | {
      readonly kind: "table"
      readonly head: ReadonlyArray<string>
      readonly rows: ReadonlyArray<ReadonlyArray<LegalInline>>
    }

export interface LegalSection {
  readonly heading: string
  readonly blocks: ReadonlyArray<LegalBlock>
}

export interface LegalDocument {
  readonly title: string
  readonly intro: ReadonlyArray<LegalBlock>
  readonly sections: ReadonlyArray<LegalSection>
}

/** Where each text lives. Exported so #39's client consent links the same URLs. */
export const LEGAL_PATHS = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
} as const

const p = (...content: ReadonlyArray<LegalInline>): LegalBlock => ({ kind: "paragraph", content })
const ul = (...items: ReadonlyArray<ReadonlyArray<LegalInline>>): LegalBlock => ({
  kind: "list",
  items,
})
const b = (emphasis: string): LegalInline => ({ emphasis })
const ph = (placeholder: LegalPlaceholder): LegalInline => ({ placeholder })

const privacyPolicyEn: LegalDocument = {
  title: "Privacy policy",
  intro: [
    p(
      "Praximo is a tool that coaches use to schedule sessions, run them as video calls, and get AI-written notes afterwards. This page explains what happens to your data.",
    ),
  ],
  sections: [
    {
      heading: "Who is responsible for what",
      blocks: [
        p(
          b("Your coach decides"),
          " what data is collected about you and what happens to it — they are the data controller. ",
          b("We run the software"),
          " on their instructions — we are the processor. If you want your data changed or deleted, ask your coach; we give them the tools to do it.",
        ),
        p("Praximo is operated by ", ph("operator"), "."),
      ],
    },
    {
      heading: "What we hold",
      blocks: [
        ul(
          [
            b("Your profile"),
            " — the name you gave, and optionally a photo, an email address, and your Telegram account id.",
          ],
          [b("Session audio"), " — recorded during the call, one track per person."],
          [
            b("Transcripts and AI notes"),
            " — the written record of the session and the summaries produced from it.",
          ],
          [
            b("Consent and technical records"),
            " — the consent you gave, its text version, and when you joined sessions.",
          ],
        ),
        p(
          "If you use ",
          b("Continue with Google"),
          " on the invitation page, we read your name, photo, email address, and Google account id from your Google profile — only when you click it, and we do not keep the Google access token.",
        ),
      ],
    },
    {
      heading: "What it is used for",
      blocks: [
        p(
          "To run the sessions and to produce written notes for your coach: a summary of the session, and a professional self-review addressed to the coach about their own coaching. Nobody but your coach sees these. We do not sell your data, we do not advertise to you, and your recordings and transcripts are not used to train AI models.",
        ),
      ],
    },
    {
      heading: "Where it is processed",
      blocks: [
        p(
          "Everything stays in the European Union — hosting, database, video calls, and transcription — ",
          b("except the AI analysis"),
          ", which runs on providers in the United States. Those requests pass through Cloudflare AI Gateway, which keeps a log of them. The providers are under contracts that forbid training on the data we send.",
        ),
        {
          kind: "table",
          head: ["Who", "What they do", "Where"],
          rows: [
            [
              "Cloudflare",
              "Hosting, file storage, email delivery, AI gateway",
              "EU (AI gateway logs: US)",
            ],
            ["Neon", "Database", "EU (Frankfurt)"],
            ["Deepgram", "Turning audio into text", "EU · keeps nothing"],
            ["LiveKit", "Video calls · our own servers", "EU"],
            [ph("llmProviders"), "AI analysis", "US"],
            ["Telegram", "Messages, if that is your channel", "Telegram's own"],
            ["Google", "Only if you use Continue with Google", "Google's own"],
          ],
        },
      ],
    },
    {
      heading: "How long it is kept",
      blocks: [
        ul(
          [b("Session audio"), " — deleted 30 days after it is transcribed."],
          [
            b("Transcripts and AI notes"),
            " — until your coach deletes them. They can delete a single session's data or your record entirely.",
          ],
          [
            b("Backups"),
            " — deleted data can survive in database backups for up to 7 more days, after which it is gone.",
          ],
        ),
        p("Deletion is permanent. There is no undo and no archive."),
      ],
    },
    {
      heading: "Your rights",
      blocks: [
        p(
          "You can ask to see your data, correct it, have it deleted, or withdraw your consent — at any time, and without giving a reason. ",
          b("Ask your coach"),
          "; they act on it. If your coach cannot help, write to ",
          ph("contactEmail"),
          " and we will. Withdrawing consent stops new sessions being scheduled; it does not by itself delete what already exists — ask for deletion too if that is what you want.",
        ),
        p(
          "You also have the right to complain to a data protection authority in ",
          ph("jurisdiction"),
          ".",
        ),
      ],
    },
    {
      heading: "Security",
      blocks: [
        p(
          "Data is encrypted in transit and at rest. Access is limited to what is needed to operate the service. If a breach affects you, we tell your coach without undue delay, and they tell you.",
        ),
      ],
    },
    {
      heading: "Changes",
      blocks: [
        p(
          "If this policy changes in a way that affects you, your coach is notified and the version at the top of this page changes. The version you agreed to is recorded with your consent.",
        ),
      ],
    },
  ],
}

const coachTermsEn: LegalDocument = {
  title: "Coach terms of service",
  intro: [],
  sections: [
    {
      heading: "1. What Praximo is",
      blocks: [
        p(
          "Praximo is software for coaches: it schedules sessions, hosts them as video calls, records and transcribes them, and produces AI-written notes — a session summary and a self-review of your coaching against a professional competency framework. It is a tool for you. It never coaches your clients and never speaks to them on your behalf beyond scheduling and reminders.",
        ),
        p("Praximo is operated by ", ph("operator"), " (“we”)."),
      ],
    },
    {
      heading: "2. Your account",
      blocks: [
        p(
          "Accounts are created by us on request — there is no self-registration. You sign in through Telegram, and your workspace gets its own Telegram bot. Keep your Telegram account secure: anyone with it can reach your workspace. Your account is yours alone and not to be shared.",
        ),
      ],
    },
    {
      heading: "3. Your responsibilities",
      blocks: [
        ul(
          [
            "You must have a lawful basis for the client data you put into Praximo, and you must not add clients who have not accepted the consent Praximo presents to them.",
          ],
          [
            "You handle your clients' requests — access, correction, deletion, withdrawal of consent — and you use the tools we give you to act on them. Withdrawal blocks new scheduling; deletion is a separate, explicit action.",
          ],
          [
            "You review AI output before relying on it. It can be wrong, incomplete, or misleading. It is not medical, psychological, legal, or financial advice, and it must not be used as such.",
          ],
          [
            "You do not use Praximo unlawfully, or to record people who have not consented to being recorded.",
          ],
        ),
      ],
    },
    {
      heading: "4. AI output",
      blocks: [
        p(
          "The notes are generated by large language models and are assistive, not authoritative. They may contain errors. You are responsible for how you use them with your clients. The competency framework the self-review draws on is described in our own words; we are not affiliated with, endorsed by, or certified by any coaching federation.",
        ),
      ],
    },
    {
      heading: "5. Availability and fees",
      blocks: [
        p(
          "Praximo is early-access software. There is no uptime guarantee, features may change, and we may have to interrupt the service for maintenance. It is currently provided ",
          ph("pricing"),
          ".",
        ),
      ],
    },
    {
      heading: "6. Processing your clients' data",
      blocks: [
        p(
          b("You are the controller, we are the processor."),
          " You decide what client data enters Praximo and what happens to it; we process it only to run the service for you and only on your instructions. Using the product is how you give those instructions.",
        ),
        ul(
          [
            b("What we process:"),
            " client profiles, session audio, transcripts, AI notes, consent records — for as long as the retention rules in the privacy policy allow.",
          ],
          [
            b("Subprocessors:"),
            " the providers listed in the ",
            { link: "privacy policy", to: LEGAL_PATHS.privacy },
            ". We may change them; we notify you before a new one starts processing, and you may object by closing your workspace.",
          ],
          [
            b("No training:"),
            " your clients' recordings, transcripts, and notes are never used to train AI models, by us or our providers.",
          ],
          [
            b("Confidentiality and security:"),
            " everyone with access is bound to confidentiality; data is encrypted in transit and at rest; access is limited to what operating the service requires.",
          ],
          [
            b("Transfers:"),
            " processing is in the EU, except AI analysis in the US, as set out in the privacy policy. You accept that transfer by using the service.",
          ],
          [
            b("Helping you:"),
            " we give you tools to answer client requests and to delete data yourself. If a personal data breach affects your clients, we tell you without undue delay and give you what you need to notify them.",
          ],
          [
            b("Deletion:"),
            " deletion through the product is permanent, subject only to the 7-day backup window. When your workspace closes, we delete its data.",
          ],
        ),
      ],
    },
    {
      heading: "7. Your data and ours",
      blocks: [
        p(
          "The practice data is yours. The software is ours. Nothing here transfers ownership either way.",
        ),
      ],
    },
    {
      heading: "8. Ending it",
      blocks: [
        p(
          "You can close your workspace at any time by asking us — offboarding is handled by hand. Your bot is released back to you; your workspace data is deleted. We may suspend or close a workspace that breaches these terms.",
        ),
      ],
    },
    {
      heading: "9. Liability",
      blocks: [
        p(
          "The service is provided as-is. To the extent the law allows, our liability is limited to ",
          ph("liabilityCap"),
          ". Nothing here limits liability that cannot lawfully be limited.",
        ),
      ],
    },
    {
      heading: "10. Changes and law",
      blocks: [
        p(
          "We will notify you of material changes to these terms; continuing to use Praximo means accepting them. These terms are governed by the law of ",
          ph("jurisdiction"),
          ". Questions: ",
          ph("contactEmail"),
          ".",
        ),
      ],
    },
  ],
}

/**
 * Only `en` is authored. Every other locale falls back to it rather than
 * rendering a gap: an untranslated legal text is still the text the coach
 * accepted, and the version records exactly that.
 */
export const coachTermsFor = (_locale: LegalLocale): LegalDocument => coachTermsEn
export const privacyPolicyFor = (_locale: LegalLocale): LegalDocument => privacyPolicyEn
