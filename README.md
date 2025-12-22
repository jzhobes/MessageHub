# MessageHub

MessageHub is a unified local viewer for your personal chat archives. It aggregates and displays message history from **Facebook**, **Instagram**, **Google Chat**, **Google Voice**, and **Google Mail (Gmail)** exports in a single, modern web interface.

It also features **DataForge AI**, a built-in studio for curating high-quality datasets to fine-tune Large Language Models (LLMs) on your authentic voice.

## Features

- **Integrated Setup Wizard:** Automatically configure your workspace, import archives, and build your database with zero command-line interaction.
- **Unified Dashboard:** Toggle between Facebook Messenger, Instagram DMs, Google Chat, Google Voice, and Gmail histories.
- **Global Search:** Search all archives with support for **glob-like syntax** in queries and **selection filtering**. Click any result to **jump** to that message in its original context.
- **Smart Ingestion:** Automatically handles duplicate messages across overlapping exports and supports incremental updates.
- **DataForge AI Studio:** Select specific threads, filter system noise, and generate formatted JSONL datasets for OpenAI fine-tuning.

## Project Structure

```
MessageHub/
├── data/                  # Default workspace location
│   ├── Facebook/
│   ├── Instagram/
│   ├── Google Chat/
│   ├── Google Voice/
│   ├── Google Mail/       # MBOX archives and extracted attachments
│   └── messagehub.db      # SQLite database (FTS5 indexed) containing all message data
├── scripts/               # Python processing scripts
│   ├── parsers/           # Platform-specific parsers (FB, IG, GChat, GVoice, GMail)
│   ├── ingest.py          # Main script: Zip extraction + DB Ingestion
│   └── utils.py           # Shared logic
├── webapp/                # Next.js frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI atoms
│   │   ├── sections/      # Major page layout blocks
│   │   ├── pages/         # Next.js pages, API routes, and page-level CSS modules
│   │   ├── styles/        # Global/Shared CSS
│   │   ├── lib/           # Shared logic and server-side utilities
│   │   └── types/         # Shared TypeScript interfaces
└── README.md              # This file
```

## Setup & Usage

### 1. Data Export & Prerequisites

**Prerequisites:**

- **Node.js 18+** (for the web application)
- **Python 3.10+** (for the ingestion engine)
- **Virtual Environment**: Managed automatically (created at `./venv` on first run).

#### Exporting Data

**Facebook:**

1. Go to [**Accounts Center** > **Your information and permissions** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2. **Create export** > **Facebook** > **Export to device**
3. **Customize information**:
   - **Your Facebook activity** > **Messages**
   - **Personal information** > **Profile information** (Required for "You" detection)
4. **Format** > **JSON**
5. **Start export**

> [!TIP] > **Incremental Exports & Safe Imports**: Meta allows you to export a **custom date range**. Since MessageHub automatically handles **duplicate messages**, you can import newer date ranges without worrying about overlapping data or double-counting messages in your database.

> [!TIP] > **Media quality** (Higher vs. Lower) is a personal preference for your viewing experience. It has **no impact** on the DataForge AI Studio or LLM data training, as the studio only processes text and reaction metadata.

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
2. Select **Google Chat**, **Voice**, and **Mail** as desired.
3. For **Mail**:
   - **Crucial for DataForge AI:** Make sure the **"Sent"** folder is included, as this contains your authentic writing voice for LLM training.
4. Click **Next Step**.
5. Select your preferred file type (**both .zip and .tgz are supported**) and change the file size to 4 GB or larger to minimize split archives.
6. Click **Create export**.

---

### 2. Configuration (.env)

You don't need to create this file manually. The **Setup Wizard** will automatically initialize a `.env` file in the project root during your first run. It stores your workspace location and security boundaries:

```bash
# Path to your active data directory
WORKSPACE_PATH="/path/to/your/data"

# Security boundaries for the file explorer (auto-set to your home directory)
ROOT_IMPORT_PATH="/Users/yourname"
ROOT_WORKSPACE_PATH="/Users/yourname"

# Optional: Instagram Auth for unauthenticated link previews
INSTAGRAM_AUTH={"sessionid":"<sessionid>","csrftoken":"<csrftoken>"}
```

#### (Optional) Getting Instagram Auth

To enable rich link previews for Instagram links (bypassing login walls):

1. Log in to [Instagram](https://instagram.com).
2. Open Developer Tools (F12) -> Network Tab.
3. Refresh and find a request to `instagram.com`.
4. Copy the `Cookie` header values for `sessionid` and `csrftoken`.

---

---

### 3. Quick Start (Run & Setup)

MessageHub comes with a unified start script that handles Python environment setup, all necessary dependency installations, and launching the application.

**Mac / Linux:**

```bash
./start.sh
```

**Windows:**

```batch
start.bat
```

1.  **Automated Environment**: The script will create a `./venv` and run `npm install` automatically on the first run.
2.  **App Ready**: Once the server starts, open [http://localhost:3000](http://localhost:3000).
3.  **Setup Wizard**: You will be greeted by the **Setup Wizard** to configure your workspace and import your data.

---

### 4. Setup Wizard Flow

1.  **Welcome**: Click **"Get Started"** on the splash screen.
2.  **Workspace**: Select any folder on your machine where you want your database and settings to live.
3.  **Import**: Select your exported `.zip` / `.tar.gz` files using the in-app file explorer to stage them for ingestion.
4.  **Confirm & Process**: Click **"Confirm"** then **"Start Processing"**. MessageHub handles extraction, merging, and indexing automatically.
5.  **Review**: Once complete, enter your dashboard to search and browse your messages.

> [!NOTE]
> It is safe to re-import the same files or overlapping archives. MessageHub uses a unique constraint to ensure each message is only stored once.

---

### 5. DataForge AI (Fine-Tuning Studio)

MessageHub includes a tool to create **"Virtual You"** datasets for training AI models.

1.  Click the **Robot Icon (🤖)** in the top header.
2.  **Filter & Select**: Choose threads that represent your best writing (high quality, recent).
3.  **Configure**:
    - **Identity**: Enter your name(s) so the AI knows who "Assistant" is.
    - **Cleanup**: Auto-remove system messages ("You missed a call") and PII (emails/phones).
    - **Reactions**: Convert reactions (👍) into text replies (`[Reacted "👍"]`) for better context.
4.  **Generate**: The server will process thousands of messages in the background and produce a `.zip` containing optimized `.jsonl` files ready for upload to OpenAI.

---

### 6. Manual Ingestion (CLI)

If you prefer to run ingestion headlessly via CLI, you can still access the underlying pipeline:

1.  **Configure environment**: Assign `WORKSPACE_PATH` in your `.env`.
2.  **Move Archives**: Place your `.zip` / `.tar.gz` files in the workspace directory.
3.  **Run Ingest**: (Defaults to scanning your workspace if no source is provided)

    ```bash
    # Mac / Linux
    ./venv/bin/python3 scripts/ingest.py

    # Windows
    venv\Scripts\python scripts\ingest.py
    ```

## Technical Details

- **Interface:** Next.js, React, Tailwind CSS (optional)
- **Database:** SQLite with **FTS5 Trigram** indexing for sub-second global search
- **Ingestion:** Python 3.10+ (multithreaded)

## Development & Testing

MessageHub includes a set of **"Golden Archives"** for local testing without using your private data.

1.  **Golden Archives**: Located in `samples/`, these are tiny, anonymized examples of each supported platform's data format.
2.  **Build Sample Workspace**: Run the following to create a `data_samples/` directory and populate it with a test database:

    ```bash
    # Mac/Linux
    ./build_samples.sh

    # Windows
    build_samples.bat
    ```

3.  **Run with Samples**: You can temporarily point the app at this workspace in your `.env`:
    ```bash
    WORKSPACE_PATH="/path/to/MessageHub/data_samples"
    ```
