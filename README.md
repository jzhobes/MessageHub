# MessageHub

**MessageHub** is a unified, fully local viewer for personal communication archives. It consolidates message history from Facebook, Instagram, Google Chat, Google Voice, and Gmail into a single, searchable interface without uploading or syncing data to the cloud.

MessageHub also includes **DataForge AI**, a dataset curation studio designed to prepare high-quality training data for fine-tuning language models on an individual’s authentic voice, while keeping all data strictly offline.

---

## 🏁 Getting Started

### Requirements

- Node.js 26+ (LTS)
- Python 3.10+
- macOS, Linux, or WSL
  > **Note for non-developers:**  
  > In practice, this means installing **Node.js** on macOS, or installing **Linux (Ubuntu recommended)** on Windows and then installing Node.js there.  
  > Python is already included on most macOS and Linux systems.

### Quick Start

Run the startup script to initialize the environment and launch the guided setup wizard.

```bash
./start.sh
```

**Stopping the App**

- Press `Command+C` / `Ctrl+C` in the terminal running the process.

---

## 📦 Data Export & Import

MessageHub ingests data from official platform exports. All data should be exported in **JSON** format where available.

Supported export sources:

- **Facebook** & **Instagram**: Select **Messages** and **Profile Information**. (Posts and Events are optional but supported for Facebook). Format must be **JSON**.
  [Download Your Information](https://accountscenter.facebook.com/info_and_permissions/dyi)
- **Google Takeout**: Select **Chat**, **Voice**, and **Mail** (ensure the **Sent** folder is included).
  [Google Takeout](https://takeout.google.com/)

> [!TIP]
> Including _Profile Information_ is critical. This allows MessageHub to reliably distinguish your own messages from other participants during analysis.

---

## ⚙️ Optional Configuration

### Instagram Link Previews (`INSTAGRAM_AUTH`)

MessageHub can fetch rich link previews for shared Instagram URLs if you provide authenticated browser cookies via `INSTAGRAM_AUTH` in the project-root `.env` file (created automatically by the setup wizard, or you can create it manually).

Add `INSTAGRAM_AUTH` using either a JSON object of cookie key/value pairs or a raw `Cookie` header string:

```env
# JSON object of cookie key/value pairs
INSTAGRAM_AUTH='{"sessionid":"...","csrftoken":"..."}'

# Or a raw Cookie header string
INSTAGRAM_AUTH="sessionid=...; csrftoken=..."
```

`.env` is loaded at startup, so restart `./start.sh` after editing `.env`; startup logs will indicate whether the credentials appear valid.

---

## 🔧 Maintenance & Utilities

Run the following commands from the `webapp/` directory:

- `npm run validate`
  Runs linting, formatting, and type checks.
- `npm run clean:all`
  Performs a full reset by deleting the local database and Python virtual environment.

---

## 🧩 Architecture Overview

- **Next.js / React** - Local web interface and application server
- **Python** - High-throughput data ingestion and preprocessing
- **SQLite** - Embedded database with full-text search
- **Transformers.js** - In-browser AI for persona and language analysis
