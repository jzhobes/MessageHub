# MessageHub

MessageHub is a unified local viewer for your personal chat archives. It aggregates and displays message history from **Facebook**, **Instagram**, and **Google Chat** exports in a single, modern web interface.

## Features

- **Unified Dashboard:** Toggle seamlessly between Facebook Messenger, Instagram DMs, and Google Chat histories.
- **Rich Media Support:** View photos, videos, and reactions directly in the chat stream.
- **Instant Search:** Search across all messages and threads using a local SQLite backend.
- **Automated Ingestion:** A single script handles Zip extraction, data merging, and database population.

## Project Structure

```
MessageHub/
├── data/                  # Default location for your exported chat history data
│   ├── Facebook/
│   ├── Instagram/
│   ├── Google Chat/
│   └── messagehub.db      # SQLite database containing all message data
├── scripts/               # Python processing scripts
│   ├── ingest.py          # Main script: Zip extraction + DB Ingestion
│   └── utils.py           # Shared logic
├── webapp/                # Next.js frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI atoms
│   │   ├── sections/      # Major page layout blocks
│   │   ├── pages/         # Next.js pages and API routes
│   │   └── styles/        # CSS Modules
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

Move your downloaded `.zip` files into your configured data folder (or the project root). Then run the ingestion script:

```bash
python3 scripts/ingest.py
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

## Technical Details

- **Frontend:** [Next.js](https://nextjs.org/) (React) with a modular component architecture.
- **Database:** SQLite (`messagehub.db`) used for high-performance querying and searching of messages + metadata.
- **Backend:** Next.js API Routes (Node.js) serve data via SQLite queries.
- **Ingestion:** Python-based pipeline (`ingest.py`) handles:
  - Zip extraction and merging (handling split archives).
  - Latin-1/UTF-8 mojibake correction.
  - Media path resolution.
  - Selective JSON cleanup.
