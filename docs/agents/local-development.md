# Local UI development

Run the four product surfaces together from the repository root:

```sh
bun run dev
```

The fixed local topology is:

| Surface | URL |
| --- | --- |
| Admin | `http://localhost:3000/admin` |
| Coach | `http://localhost:3001/?b=<telegram_bot_id>` |
| Client | `http://localhost:3002/legal/privacy?lang=en` |
| WWW stage shell | `http://localhost:3003/` |

Admin and Coach use real development credentials and the connected development
database. There is no mock login or authentication bypass. Admin uses the first
configured `ADMIN_TELEGRAM_IDS` entry. Coach also requires
`DEV_COACH_TELEGRAM_ID` and a `?b=` selector naming the connected Workspace Bot
for that same Coach; the query in `.env.example` shows how to obtain the pair.

Use `bun run db:demo` to seed repeatable Client and Session data without
re-provisioning the bot. Bot and Pipeline Workers are not required for the
ordinary local UI loop.

UI Lab runs independently:

```sh
bun run ui:dev
```

Open `http://localhost:3004/`.
