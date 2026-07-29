# Product copy: who is speaking, and to whom

Every user-facing string in this product is written by the owner or by an agent, in this repository. There is no translation vendor and no extraction step ([`packages/i18n`](../../packages/i18n/src/index.ts) explains why there is no i18n library either). What replaces a style guide living in somebody's head is this file.

Three voices, one per reader. Getting the reader wrong is the single most expensive copy mistake here, because it is invisible: the sentence is grammatical, the screen renders, and the wrong person is being addressed.

## The three voices

**The coach, in the bot.** A partner's register, settled in [#164](https://github.com/apshenichniy/praximo/issues/164): tell them what happened, then what to do about it, and put the explanation where it costs nothing to skip. The catalogue is [`apps/bot/src/messages.ts`](../../apps/bot/src/messages.ts).

**The coach, in the Coach App.** The same face without the chat's emoji density. A screen carries its own structure — headings, sections, a bottom button — so the copy does not have to signal any of it. The catalogue is [`apps/coach/src/features/i18n/coach-copy/`](../../apps/coach/src/features/i18n/coach-copy).

**The client.** Addressed by **their coach's assistant**, never by a platform ([client-onboarding-auth.md](../spec/client-onboarding-auth.md) §Principles). The client did not choose Praximo, has no account with us, and is not our user in any sense they would recognise — they are their coach's client, and the bot they are talking to belongs to that coach. There are **two** client catalogues, split by what carries the words. [`packages/i18n/src/client-copy.ts`](../../packages/i18n/src/client-copy.ts) holds what the bot and the Acceptance Page both say — it is in the package rather than in an app because two Workers render the same consent text. [`packages/email/src/invite-email-copy.ts`](../../packages/email/src/invite-email-copy.ts) holds what the invitation *email* says ([#58](https://github.com/apshenichniy/praximo/issues/58)), and lives beside the template because there the email **is** the surface. Neither is strict: a client mid-acceptance, or a coach mid-send, must never meet a thrown `MissingTranslation`. Both are held level across the three languages by a parity test instead.

**The client app's page chrome** is a fourth, smaller thing and not a fourth voice: the footer's appearance switch, and whatever the acceptance page's frame comes to need. It says nothing *to* anybody — it labels controls — so it stays in the app that renders it, [`apps/client/src/features/i18n/chrome-copy.ts`](../../apps/client/src/features/i18n/chrome-copy.ts), and speaks in the client's register when it does speak. Words addressed to the client belong in the catalogue above, not here.

## Standing rules

**No URLs in body text — in chat.** Every action is an inline button ([#164](https://github.com/apshenichniy/praximo/issues/164)). A `t.me/…?start=` payload wrapped across four lines of a phone reads like phishing, and it is worst in the one message that asks for a legal agreement.

The rule is Telegram's, and **email is the stated exception** ([#58](https://github.com/apshenichniy/praximo/issues/58)): mail clients strip buttons, and readers paste links into a real browser. An invitation email carries its button *and* the bare URL beneath it, and the plain-text part carries the URL alone. What survives from the rule is its reason — the link must be short and legible — which is why the web door is `/i/<token>` rather than `/invite/`.

**No gender-agreeing verb forms** in UK/RU copy about a person whose gender the system does not know — which is every person in it ([#16](https://github.com/apshenichniy/praximo/issues/16), [privacy-copy.md](../spec/privacy-copy.md) §Conventions). Write `{coach} напише тут`, never `{coach} написала`. Future tense and impersonal constructions are gender-neutral in both languages and are usually the way out: `профиль создан`, not `создала профиль`.

**A person's name is interpolated only in the nominative**, and only into a slot where the nominative is grammatical. When a sentence needs an oblique case, use a common noun («ваш коуч») and put the name in the surrounding interface instead. **Never build a declension table for an operator-entered string** ([#193](https://github.com/apshenichniy/praximo/issues/193), [#222](https://github.com/apshenichniy/praximo/issues/222)).

What makes declension unsafe is *whose string it is*: `client.name` and the coach's own name are labels an operator typed into their own list — «Анна через Марину», a surname-first entry, a non-Slavic name — and a case table applied to an arbitrary string produces confident nonsense. The name is not lost by dropping it from the sentence: the bot chat is titled with the coach's workspace name and described "Coaching with {coach}", and the invitation is pasted by the coach into their own conversation with the client — the reader already knows whose bot this is. A **surface that means to carry the name owes it explicitly**; the Acceptance Page's frame is [#57](https://github.com/apshenichniy/praximo/issues/57)'s to specify, and until it does, no copy should assume it. Secondary benefit: «коуч» takes no gender agreement, so the rule above stops being a trap in every new sentence. `en` is unaffected — it inflects nothing, and still names the coach in the same slots.

Where the client is the sentence's subject, the reflexive is the idiomatic form and is used instead: «Попросите у **своего** коуча», not «у вашего коуча». Same common noun, same rule.

**Split a sentence that wraps a value, rather than templating it.** Word order differs between these three languages, and a placeholder in the middle of a string is a translation waiting to read backwards. A *count* is the exception: it is the same token everywhere, and splitting it from the noun it agrees with makes the plural form unreachable — `plural()` exists for exactly that.

**Client-facing names for things are plain words, not the coach's terms.** The intake is «первая встреча» to a client and `Intake` to their coach. Deliberately **not** «знакомство»: that is what the industry calls the *chemistry* session, which this product does not run ([#1](https://github.com/apshenichniy/praximo/issues/1) §Out of scope), and spending the word on the intake would guarantee the confusion the distinction exists to prevent.

**Versioned text is versioned by its content.** `contentDigest` over the text produces the version recorded against an acceptance, so an edit cannot ship as the same document somebody already agreed to. Whether that version is *one across all three languages* or *one per language* depends on who can change language afterwards: the coach can and is never re-asked, so their terms carry one version ([#130](https://github.com/apshenichniy/praximo/issues/130)); the client cannot, so their consent carries one per language ([#56](https://github.com/apshenichniy/praximo/issues/56)).

**English is the reference.** Every other catalogue is filled out against it leaf by leaf, and a blank leaf throws in development and falls back in production. The two client-facing catalogues resolve *non-strict* in every build — nobody mid-consent should meet a thrown `MissingTranslation` — so each carries a test holding its three locales level instead (`client-copy.test.ts`, `chrome-copy.test.ts`). A catalogue that opts out of strictness owes one — a coach reading one English sentence in a Ukrainian screen is a smaller failure than a coach reading `terms.points.3`.

## What to check before adding a string

1. Which of the three readers is this for? Write it in their catalogue, in their voice.
2. Does it name an action? Then it is a button, not a link in prose.
3. Does it say something about a person? Then it cannot agree with their gender.
4. Does it interpolate a person's name? Then the slot has to take the nominative — otherwise write «ваш коуч» and let the frame carry the name.
5. Does it wrap a value? Split it — unless the value is a count.
6. Is it legally operative? Then it is versioned from its own content, and the version has to answer "which text did they agree to", not "which release was this".
