# ICF Materials — Content and Licensing

Research for grounding the ICF-mentor LLM role (the Mentor Review artifact) in praximo prompts: what the current ICF documents are, where the canonical texts live, whether official Ukrainian/Russian translations exist, and what ICF's copyright position allows. Researched for wayfinder ticket [#4](https://github.com/apshenichniy/praximo/issues/4). All URLs verified resolving on **2026-07-19**.

## Sources

| # | Material | Version | URL |
|---|----------|---------|-----|
| 1 | 2025 ICF Core Competencies (page) | current | <https://coachingfederation.org/credentialing/coaching-competencies/icf-core-competencies/> |
| 2 | 2025 ICF Core Competencies (PDF, canonical text) | Released Sep 2025, rev. 09.08.25 | <https://coachingfederation.org/wp-content/uploads/2025/09/icf-cs-core-competencies-2025.pdf> |
| 3 | Core Competencies resource page (translations index) | — | <https://coachingfederation.org/resource/icf-core-competencies/> |
| 4 | 2019→2025 comparison chart (PDF) | rev. 09.08.25 | <https://coachingfederation.org/wp-content/uploads/2025/09/icf-cs-core-comptencies-comparison-2025.pdf> |
| 5 | PCC Markers (resource page) | — | <https://coachingfederation.org/resource/icf-pcc-markers/> |
| 6 | PCC Markers (PDF, canonical text) | Revised Nov 2020, rev. 06.25.21 | <https://coachingfederation.org/wp-content/uploads/2025/02/icf-cs-pcc-markers-2021.pdf> |
| 7 | PCC Minimum Skills Requirements (PDF) | rev. 1.26.2026 | <https://coachingfederation.org/wp-content/uploads/2025/09/icf-cs-pcc-minimum-skills-requirements.pdf> |
| 8 | Criteria for assessing PCC (performance evaluation) | — | <https://coachingfederation.org/credentialing/performance-evaluations/criteria-for-assessing-pcc/> |
| 9 | Core Competencies 2025, Russian (PDF, official) | Rev. 31 Oct 2025 | <https://coachingfederation.org/wp-content/uploads/2026/01/Russian-icf-core-competencies-2025.pdf> |
| 10 | PCC Markers, Russian (PDF, official) | Nov 2020 | <https://coachingfederation.org/wp-content/uploads/2025/02/russian-icf-cs-pcc-markers-2021.pdf> |
| 11 | ICF Code of Ethics (page) | Effective Apr 1, 2025 | <https://coachingfederation.org/credentialing/coaching-ethics/icf-code-of-ethics/> |
| 12 | ICF Code of Ethics (PDF) | Board approved Oct 2024 | <https://coachingfederation.org/wp-content/uploads/2025/03/icf-ethics-code-of-ethics-2025.pdf> |
| 13 | ICF policies & statements (copyright / terms) | — | <https://coachingfederation.org/about/policies-statements/> |
| 14 | Mentor coaching (definition + requirements) | — | <https://coachingfederation.org/education-professional-development/find-professional-development/mentor-coaching/> |
| 15 | Mentoring & supervision requirements (credentialing) | — | <https://coachingfederation.org/credentialing/prepare-for-icf-credential-application/mentoring-and-supervision-requirements/> |
| 16 | ICF Mentor Coach Handbook (PDF) | Apr 2026 | <https://coachingfederation.org/wp-content/uploads/2026/04/icf-cs-mentor-specialization-handbook.pdf> |
| 17 | ICF Ukraine — Code of Ethics page (Ukrainian) | — | <https://icf-ukraine.org/standarti-icf/kodeks-etiki-icf> |
| 18 | ICF Ukraine — Core Competencies page (summary only) | — | <https://icf-ukraine.org/standarti-icf/klyuchovi-kompetenciyi-icf> |

## Digests

### 1. ICF Core Competencies — current edition is the **2025 model**

The 2019 model was superseded in September 2025. The 2025 update keeps the same 8 competencies but adds 5 new sub-competencies, revises 11, updates one competency definition, and adds a glossary appendix (source 2, p. 2). The canonical PDF (source 2, 15 pages) is structured as four domains, 8 competencies, **68 numbered sub-competencies** (`1.01`–`8.09`):

| Domain | Competency | Sub-points |
|--------|-----------|------------|
| A. Foundation | 1. Demonstrates Ethical Practice | 1.01–1.07 (7) |
| A. Foundation | 2. Embodies a Coaching Mindset | 2.01–2.10 (10) |
| B. Co-Creating the Relationship | 3. Establishes and Maintains Agreements | 3.01–3.12 (12) |
| B. Co-Creating the Relationship | 4. Cultivates Trust and Safety | 4.01–4.06 (6) |
| B. Co-Creating the Relationship | 5. Maintains Presence | 5.01–5.07 (7) |
| C. Communicating Effectively | 6. Listens Actively | 6.01–6.06 (6) |
| D. Cultivating Learning and Growth | 7. Evokes Awareness | 7.01–7.11 (11) |
| D. Cultivating Learning and Growth | 8. Facilitates Client Growth | 8.01–8.09 (9) |

Each competency has a one-to-three-sentence definition; sub-points are single behavioral sentences. The appendix glossary (~50 terms) defines coaching vocabulary, including **Mentor Coach** and **Technology** (the latter explicitly covers "AI systems" used in coaching). The full text is short — roughly 3–4k tokens of English prose — so token size is not a constraint for prompt use; licensing is (see below).

The 2019→2025 comparison chart (source 4) maps old sub-points to new numbering — useful if we ever need to reconcile older training materials.

### 2. PCC Markers — current text is **Revised November 2020**, now wrapped in the PCC Minimum Skills Requirements

The PCC Markers (source 6, 5 pages) are the assessor-facing behavioral indicators for performance evaluations. Structure:

- **Competency 1** — no markers; assessed as overall alignment with the Code of Ethics and staying "in the role of coach".
- **Competency 2** — no dedicated markers; assessed through 11 markers borrowed from other competencies (4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.5, 7.1, 7.5) plus the written exam.
- **Competencies 3–8** — **37 markers total**: C3 ×4, C4 ×4, C5 ×5, C6 ×7, C7 ×8, C8 ×9. Each marker is one sentence beginning "Coach …".

The document warns the markers "should not be used as a checklist in a formulaic manner" — relevant to Mentor Review prompt design: the LLM should assess holistically, not score a checklist.

**2026 packaging change:** for applications on or after January 1, 2026, ICF points applicants to the **PCC Minimum Skills Requirements** (source 7, rev. 1.26.2026). Per ICF's own blog, the PCC requirements "have not changed" — the MSR document restates the same 37 marker sentences as "Behaviors Consistent With ICF Coaching Standards" and adds, per competency, "Key Skills" and "Behaviors Inconsistent With ICF Coaching Standards" lists. The inconsistent-behavior lists (e.g., coach chooses the topic; coach primarily gives advice; consulting/therapeutic mode) are directly useful negative criteria for the Mentor Review. ACC and MCC Minimum Skills Requirements documents exist in the same format.

No marker revision aligned to the 2025 competency wording has been announced as of the access date; the Nov 2020 markers remain current.

### 3. Ukrainian / Russian translations

**Russian — official translations exist, hosted by ICF Global:**

- Core Competencies 2025: «Ключевые Компетенции ICF 2025», Rev. 31 Oct 2025 (source 9), translated by Irina Bakhareva MCC and Georgy Simonyan PCC. A 2019-model Russian translation also remains available (`russian-icf-cs-core-competencies-2019.pdf`).
- PCC Markers: official Russian version of the Nov 2020 markers (source 10).
- Code of Ethics: Russian is listed among the official translations on the Code of Ethics page (source 11).

**Ukrainian — no official translation of the Core Competencies or PCC Markers found (recorded as absent):**

- ICF Global's translation lists (sources 3, 5, 11) do not include Ukrainian for the Core Competencies, PCC Markers, or Code of Ethics (Code of Ethics list: Arabic, Armenian, English, French, German, Italian, Portuguese, Romanian, Russian, Spanish).
- ICF Ukraine's Core Competencies page (source 18) is a summary/gateway that links to English materials on coachingfederation.org — no translated document.
- Exception: ICF Ukraine hosts a **full Ukrainian translation of the ICF Code of Ethics** (source 17, downloadable), though its edition date and official-translation status are not stated on the page.

**Consequence for praximo:** with `language: en | uk | ru` per member, Ukrainian Mentor Reviews cannot cite an official Ukrainian competency text. The prompt should ground in the English canonical text and have the LLM produce Ukrainian output, keeping competency names bilingual (Ukrainian gloss + English original) rather than inventing a "translation" that could be mistaken for an official one.

### 4. Licensing position

ICF's copyright terms live on the policies & statements page (source 13). Key clauses (short quotes, © International Coaching Federation):

- Ownership: "All materials on the ICF website … are owned and copyrighted by the International Coaching Federation."
- Permitted use: ICF "authorizes you to access, download, and print materials … ONLY for your personal or for limited noncommercial use."
- Everything else: reproduction, distribution, sale, transmission, or display of ICF materials "is strictly prohibited except with the prior written consent of ICF."
- Trademarks: no one may use "the name, acronym, logo, or any of the family of marks of the ICF" without prior written consent of ICF leadership.
- Permission requests go through the ICF contact form (<https://coachingfederation.org/about/contact-us/>) or `icfpr@coachingfederation.org`.

Every ICF PDF carries a "© International Coaching Federation" notice. There is no open license, no Creative Commons, and no published carve-out for LLM/AI use or for embedding in software products.

#### Risk assessment

| Use | Reading of ICF terms | Risk |
|-----|---------------------|------|
| Linking to ICF pages/PDFs from the product | Not a reproduction | None |
| Competency/marker **names, numbering, structure** (e.g., "4. Cultivates Trust and Safety", "37 markers") | Titles, facts, and structure; not substantial expression | Low |
| Original **paraphrases** of competencies/markers in prompts and artifacts | Independent expression of unprotectable ideas/methods | Low |
| **Short quotes** with attribution in artifacts shown to the coach | Ordinary fair-use-style quotation | Low |
| **Full verbatim text embedded in prompts** (internal, never displayed) | Still reproduction of the whole work inside a commercial product; "personal or limited noncommercial use" does not cover it | Medium — not permitted on a plain reading; requires written consent |
| **Full verbatim text displayed/distributed to users** (docs, UI, artifacts) | Explicitly prohibited without prior written consent | High |
| Using the ICF name/logo in marketing implying affiliation or endorsement | Trademark clause | High |

Note the direction of ICF's own materials: the 2025 glossary defines coaching "Technology" as including AI systems, and ICF has an AI Coaching Standards ecosystem — ICF is aware of AI products but has published no license for its texts in them.

#### Recommendation: verbatim vs paraphrase

1. **Do not embed the full ICF texts verbatim in prompts or product content** without written permission. The competency model and markers are compact; the value is in the structure and behavioral criteria, which we can express in our own words.
2. **Build the Mentor Review prompt on:** (a) the exact competency names and numbering (low risk, needed for coach-recognizable output); (b) original paraphrases of the 68 sub-competencies and 37 markers, written from the canonical PDFs; (c) the MSR "Behaviors Inconsistent" ideas as paraphrased negative criteria; (d) the "not a checklist" principle — instruct holistic assessment.
3. **In generated artifacts:** attribute the framework ("assessed against the ICF Core Competencies model, © International Coaching Federation"), link to the official PDFs, and state that praximo is not affiliated with or endorsed by ICF. Keep any direct quotes short and attributed.
4. **Request written permission from ICF** (contact form / `icfpr@coachingfederation.org`) if we later want verbatim competency/marker text in prompts or UI — e.g., a "show the official wording" feature. Until granted, paraphrase-only.
5. **Language handling:** ground prompts in the English canonical text for all three product languages; for `ru`, official translations exist if we ever get permission to surface text; for `uk`, none exists — never present our Ukrainian rendering as official.

### 5. Adjacent materials

**ICF Code of Ethics** (sources 11, 12): current edition Board-approved October 2024, effective April 1, 2025. Structure: Purpose; ICF Core Values and Ethical Principles (4 values); Commitments for all within the ICF ecosystem; Ethical Standards for ICF Professionals (5 sections, 23 standards); the Pledge of Ethics; appendix with definitions. Competency 1 assessment presumes alignment with this Code, so the Mentor Review prompt needs at least a paraphrased digest of the 23 standards.

**Mentor coaching — definition** (source 14; also the 2025 Core Competencies glossary): a collaborative process in which a coach receives feedback on observed or recorded coaching sessions from an experienced coach, to develop their skills in alignment with the ICF Core Competencies. This is precisely the role praximo's Mentor Review artifact emulates (with the standard caveat: an LLM artifact is not ICF mentor coaching and generates no credentialing hours).

**Mentor coaching — requirements for credentials** (sources 14, 15), the facts a future ICF hours journal must model:

- **10 hours** of mentor coaching over a **minimum of 3 months**, required for ACC, PCC, and MCC applications (and ACC renewal).
- At least **3 of the 10 hours must be one-on-one**; the rest may be group sessions with **no more than 10 participants**.
- Mentor credential requirements: ACC applicants — mentor holds valid ACC (renewed at least once), PCC, or MCC; PCC applicants — valid PCC or MCC; MCC applicants — valid MCC.
- Application records per mentoring relationship: mentor's name, email, credential level, relationship dates, and hours completed. No documents from the mentor are submitted, but the mentor must be able to confirm the mentoring took place. These five fields are the natural schema for the hours journal entry.

**Mentor Coach Specialization** (source 16 and <https://coachingfederation.org/blog/introducing-the-mentor-coach-specialization/>): as of 2026 ICF is rolling out a formal Mentor Coach Specialization with its own handbook and qualification requirements — worth re-checking when the hours journal feature is specced, as it may formalize who counts as a qualified mentor.

## Open questions

- ICF has not said whether/when the PCC Markers will be re-issued against the 2025 sub-competency numbering; re-check before finalizing prompt numbering (markers currently use 2019-era `x.y`, competencies use 2025 `x.0y`).
- The edition and official status of ICF Ukraine's Ukrainian Code of Ethics translation is unstated; confirm with ICF Ukraine if we want to reference it.
- Whether ICF grants text-use permissions to software products (and on what terms) is unknown until we ask — no published policy either way.
