# Catastrophia Ticket Bot - Project Context

## Overview
This project is a custom Discord ticket management bot specifically tailored for the **Catastrophia Discord server**. It is a fork of the popular open-source ticket management bot [`discord-tickets/bot`](https://github.com/discord-tickets/bot) originally created by `eartharoid`.

## Key Modifications (from upstream)
- Removed ticket close confirmations.
- Removed extra info messages.
- Removed ticket cooldowns.
- Fixed unhandled permission issues.

## Technology Stack
- **Environment:** Node.js (v18+)
- **Core Libraries:**
  - `discord.js` (v14) for interacting with the Discord API.
  - `fastify` for the HTTP server and web APIs.
  - `@prisma/client` and `prisma` for database ORM (supports SQLite, MySQL, and PostgreSQL).
  - `@sentry/node` for error tracking and performance profiling.
- **Other Notable Dependencies:** `mustache` (templating), `i18n` (internationalization), `dotenv` (environment variables), `keyv` (caching/key-value store).

## Project Structure
- `src/` - Main source code directory.
  - `client.js` / `index.js` - Bot initialization and setup.
  - `http.js` - Fastify web server setup.
  - `commands/` - Slash commands logic.
  - `listeners/` - Discord event listeners.
  - `buttons/`, `menus/`, `modals/`, `autocomplete/` - UI and interactive component handlers.
  - `routes/` - HTTP API routes for the Fastify server.
  - `schemas/` - Validation or DB schemas.
  - `i18n/` - Localization and internationalization files.
- `scripts/` - Maintenance and utility scripts (`db.dump`, `db.prune`, `db.restore`, `keygen`).
- `db/` - Prisma schema definitions for different database engines (`mysql`, `postgresql`, `sqlite`).

## Important Commands
- **Start the bot:** `npm start`
- **Lint the code:** `npm run lint`
- **Open Prisma Studio:** `npm run studio`
- **Database Scripts:** `npm run db.dump`, `npm run db.prune`, `npm run db.restore`
