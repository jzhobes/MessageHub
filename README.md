# MessageHub

MessageHub is a unified local viewer for your personal chat archives. It aggregates and displays message history from **Facebook**, **Instagram**, **Google Chat**, and **Google Voice** exports in a single, modern web interface.

It also features **DataForge AI**, a built-in studio for curating high-quality datasets to fine-tune Large Language Models (LLMs) on your authentic voice.

## Features

- **Unified Dashboard:** Toggle between Facebook Messenger, Instagram DMs, Google Chat, and Google Voice histories.
- **DataForge AI Studio:** Select specific threads, filter system noise, and generate formatted JSONL datasets for OpenAI fine-tuning.
- **Global Search:** Instantly search all archives. Click any result to **jump** to that message in its original context.
- **Rich Media Support:** View photos, videos, and reactions directly in the chat stream.
- **Automated Ingestion:** A single script handles Zip extraction, data merging, and database population.

## Project Structure

```
MessageHub/
├── data/                  # Default location for your exported chat history data
│   ├── Facebook/
│   ├── Instagram/
│   ├── Google Chat/
│   ├── Google Voice/
│   └── messagehub.db      # SQLite database containing all message data
├── scripts/               # Python processing scripts
│   ├── parsers/           # Platform-specific parsers
│   ├── ingest.py          # Main script: Zip extraction + DB Ingestion
│   └── utils.py           # Shared logic
├── webapp/                # Next.js frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI atoms
│   │   ├── sections/      # Major page layout blocks
│   │   ├── pages/         # Next.js pages, API routes, and page-level CSS modules
│   │   ├── styles/        # Global/Shared CSS
│   │   ├── utils/         # Helper functions (DB, Dates, etc.)
│   │   └── types.ts       # Shared TypeScript interfaces
└── README.md              # This file
```

## Setup & Usage

### 1. Data Export & Prerequisites

#### Exporting Data

**Facebook:**

1. Go to [**Accounts Center** > **Your information and permissions** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2. **Create export** > **Facebook** > **Export to device**
3. **Customize information**:
   - **Your Facebook activity** > **Messages**
   - **Personal information** > **Profile information** (Required for "You" detection)
4. **Format** > **JSON**
5. **Media quality** > **Higher quality** (optional, but recommended)
6. **Start export**

**Instagram:**

1. Go to [**Accounts Center** > **Your information and permissions** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2. **Create export** > **Instagram** > **Export to device**
3. **Customize information**:
   - **Your Instagram activity** > **Messages**
   - **Personal information** > **Personal information**
4. **Format** > **JSON**
5. **Start export**

**Google:**

1. Go to [Google Takeout](https://takeout.google.com/).
2. Select **Google Chat**. (Select **Voice** if desired).
3. Click **Next Step**.
4. Change file size to 4 GB or larger to minimize split zips (though split zips are supported).
5. Click **Create export**.

---

### 2. Configuration (.env)

Create a `.env` file in the **project root**. This configuration is used by both the ingestion script and the webapp.

```bash
# Path to your data directory (where zips and database live)
# Can be absolute (/Users/you/data) or relative (./data)
DATA_PATH=data

# Optional: Instagram Auth for unauthenticated link previews
INSTAGRAM_AUTH={"sessionid":"<sessionid>","csrftoken":"<csrftoken>"}
```

_If `DATA_PATH` is omitted, the `data/` folder in the project root is used by default._

#### (Optional) Getting Instagram Auth

To enable rich link previews for Instagram links (bypassing login walls):

1. Log in to [Instagram](https://instagram.com).
2. Open Developer Tools (F12) -> Network Tab.
3. Refresh and find a request to `instagram.com`.
4. Copy the `Cookie` header values for `sessionid` and `csrftoken`.

---

### 3. Ingest Data

First, set up the Python environment (install dependencies like `beautifulsoup4` and `python-dateutil`):

**Unix (Mac/Linux):**

```bash
./setup.sh
```

**Windows:**

```cmd
setup.bat
```

Move your downloaded `.zip` files into your configured data folder (default: `data/`). Then run the ingestion script:

```bash
./venv/bin/python3 scripts/ingest.py
# On Windows: venv\Scripts\python scripts/ingest.py
```

**What this script does:**

1.  **Scans** for `.zip` files (Facebook, Instagram, Google Chat).
2.  **Extracts** them into organized, merged platform folders (`Facebook`, `Instagram`, etc.).
3.  **Parses** message JSONs, fixing text encoding (mojibake) on the fly.
4.  **Populates** a local SQLite database (`messagehub.db`) for fast access.
5.  **Cleans up** bulky `messages.json` files for Facebook/Instagram to save disk space (media is preserved).

---

### 4. Run the Viewer

Navigate to the webapp directory and start the dev server:

```bash
cd webapp
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to browse your messages.

### 5. DataForge AI (Fine-Tuning Studio)

MessageHub includes a tool to create **"Virtual You"** datasets for training AI models.

1.  Click the **Robot Icon (🤖)** in the top header.
2.  **Filter & Select**: Choose threads that represent your best writing (high quality, recent).
3.  **Configure**:
    - **Identity**: Enter your name(s) so the AI knows who "Assistant" is.
    - **Cleanup**: Auto-remove system messages ("You missed a call") and PII (emails/phones).
    - **Reactions**: Convert reactions (👍) into text replies (`[Reacted "👍"]`) for better context.
4.  **Generate**: The server will process thousands of messages in the background and produce a `.zip` containing optimized `.jsonl` files ready for upload to OpenAI.

## Technical Details

- **Frontend:** [Next.js](https://nextjs.org/) (React) with a modular component architecture.
- **Database:** SQLite (`messagehub.db`) accessed via `better-sqlite3` for high-performance querying.
- **Dataset Engine:**
  - **Async Processing:** Non-blocking job queue for generating large datasets without freezing the UI.
  - **Tokenization:** Uses `tiktoken` to strictly adhere to LLM context limits (2M tokens/file).
- **Ingestion:** Python-based pipeline (`ingest.py`) handles:
  - Zip extraction and merging (handling split archives).
  - Data parsing and ingestion into SQLite.
  - Media path resolution.
  - Selective JSON cleanup.
