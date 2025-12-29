# MessageHub

MessageHub is a unified **fully local** viewer for your personal content archives. It aggregates and displays history from **Facebook**, **Instagram**, **Google Chat**, **Google Voice**, and **Gmail** exports in a single hub, ensuring your sensitive data never leaves your machine.

It also features **DataForge AI**, a built-in studio for curating high-quality datasets to fine-tune Large Language Models (LLMs) on your authentic voice.

## Features

- **Integrated setup wizard:** Automatically configure your workspace, import archives, and build your database with zero command-line interaction.
- **Unified dashboard:** Toggle between Facebook, Instagram, Google Chat, Google Voice, and Gmail content history.
- **Facebook social activity:** View your Facebook **Events**, **Posts**, and **Check-ins** formatted as native timeline events, separate from private messages.
- **Global search:** Search all archives with support for **glob-like syntax** in queries and **selection filtering**. Click any result to **jump** to that item in its original context.
- **Rich URL previews:** Instant metadata generation for links (title, description, image) from **Reddit**, **Instagram**, and **Facebook**, including a custom proxy to resolve gated Facebook "lookaside" images.
- **Smart ingestion:** Automatically handles duplicate content across overlapping exports and supports incremental updates.
- **DataForge AI Studio:** Select specific threads, filter system noise, and generate formatted JSONL datasets for OpenAI fine-tuning.
- **Privacy by design:** Everything—from indexing to AI dataset generation—happens locally inside your workspace. No data is uploaded to any cloud service.

---

## 🚀 Quick Start (Run & Setup)

Run the start script to automatically initialize the environment, build the application, and launch the **setup wizard**.

**Mac / Linux / WSL** (Windows requires WSL):

```bash
./start.sh
```

- **To Stop**: Press `Ctrl+C` in your terminal to shut down the server.
- _Note: The first run includes an automated production build; subsequent starts are significantly faster._

---

## 🛠 Setup & Workflow

### 1. Requirements & Troubleshooting

Before running the start script, ensure you have:

- **Node.js 20+**
- **Python 3.10+**
- **Supported Environments**: Mac, Linux, and **WSL**. (Native Windows CMD/PowerShell is not supported).

#### Troubleshooting

- **Linux/WSL users**: If the script fails to create a virtual environment, run: `sudo apt install python3-venv`.
- **"Module did not self-register"**: If you change Node versions or upgrade your OS, run: `cd webapp && npm rebuild better-sqlite3`.
- **SQLite "trigram" error**: Ensure your system SQLite is 3.34+ (Ubuntu 22.04+).

### 2. Exporting Your Data

> [!IMPORTANT] > **Profile Information:** You **must** include your Profile/Personal information in your exports. Without this, MessageHub cannot differentiate between your own messages and those of other senders.

#### Facebook

1.  Go to [**Accounts Center** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2.  **Create export** > **Facebook** > **Export to device**.
3.  **Customize information**: Select **Messages** and **Profile information** (**REQUIRED** for identity detection).
4.  **Format**: **JSON**.

#### Instagram

1.  Go to [**Accounts Center** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2.  **Create export** > **Instagram** > **Export to device**.
3.  **Customize information**: Select **Messages** and **Personal information** (**REQUIRED** for identity detection).
4.  **Format**: **JSON**.

#### Google (Chat, Voice, Gmail)

1.  Go to [Google Takeout](https://takeout.google.com/).
2.  Select **Google Chat**, **Voice**, and **Mail**.
3.  For **Mail**: Ensure the **"Sent"** folder is included.
4.  **Format**: Both **.zip** and **.tgz** are supported.

> [!TIP] > **Incremental Exports**: MessageHub automatically handles duplicate messages, so it is safe to import overlapping date ranges.

### 3. Setup Wizard Flow

1.  **Welcome**: Click **"Get Started"** on the splash screen.
2.  **Workspace**: Select the folder where your database and settings will live.
3.  **Import**: Select your exported `.zip` / `.tar.gz` files using the in-app file explorer to stage them.
4.  **Confirm & Process**: MessageHub handles extraction, merging, and indexing automatically.
5.  **Review**: Once complete, enter your dashboard to search and browse your content history.

---

## 🤖 DataForge AI (Fine-Tuning Studio)

Create **"Virtual You"** datasets for training AI models.

1.  Click the **Robot Icon (🤖)** in the top header.
2.  **Filter & Select**: Choose threads that represent your best writing.
3.  **Configure**: Set your Identity (names), Cleanup rules, and Reaction handing.
4.  **Generate**: The server produces a `.zip` containing optimized `.jsonl` files ready for OpenAI fine-tuning.

---

## 🔧 Maintenance & Advanced Usage

### Maintenance Scripts (from `webapp/`)

- `npm run validate`: Runs linting (with auto-fix), formatting, type-checking, and tests.
- `npm run clean`: Deletes the `.next` production build to force a fresh build.
- `npm run clean:all`: Factory reset. Deletes build, `venv`, and `data_samples`.

### Manual Ingestion (CLI)

Ensure `WORKSPACE_PATH` is set in your `.env`, then run:

```bash
./venv/bin/python3 scripts/ingest.py
```

### Development & Testing

Build a sample workspace using the **"Golden Archives"**:

```bash
./build_samples.sh
```

---

## 📝 Technical Overview

### Project Structure

```
MessageHub/
├── data/                  # Default workspace location
├── scripts/               # Python processing scripts (Parsers & Ingestion)
├── webapp/                # Next.js frontend application
└── README.md
```

### Technical Details

- **Interface:** Next.js 16, React 19, Vanilla CSS.
- **Modern Web Platform:** Leverages **CSS Anchor Positioning**, **Popover API**, **Native CSS Nesting**, and **@starting-style** for high-performance, native-feeling interactions.
- **Database:** SQLite with **FTS5 Trigram** indexing for sub-second global search. Everything is stored in an encrypted-at-rest-ready local `.db` file.
- **Ingestion:** Python 3.10+ (high-speed parsers with SQLite WAL mode). Processing is 100% offline.

### Configuration (.env)

Managed automatically by the **Setup Wizard**.

```bash
WORKSPACE_PATH="/path/to/your/data"
ROOT_IMPORT_PATH="/Users/yourname"
ROOT_WORKSPACE_PATH="/Users/yourname"
INSTAGRAM_AUTH={"sessionid":"...","csrftoken":"..."}
```
