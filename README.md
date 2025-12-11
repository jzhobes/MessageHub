# MessageHub

MessageHub is a unified local viewer for your personal chat archives. It aggregates and displays message history from **Facebook**, **Instagram**, and **Google Chat** exports in a single, modern web interface.

## Features

- **Unified Dashboard:** Toggle seamlessly between Facebook Messenger, Instagram DMs, and Google Chat histories.
- **Rich Media Support:** View photos, videos, and reactions directly in the chat stream.
- **Search:** Filter threads instantly by name or participant.
- **Infinite Scroll:** Smoothly browse through years of message history with efficient pagination.
- **Data Processing:** Custom scripts to handle massive export files (splitting large JSONs) and deduplicate file attachments.
- **Privacy-First:** localized processing—your data stays on your machine.

## Project Structure

```
MessageHub/
├── data/                  # Your exported chat history data
│   ├── Facebook/
│   ├── Instagram/
│   └── Google Chat/
├── scripts/               # Python processing scripts
│   ├── generate_google_chat_index.py
│   └── split_google_chat_messages.py
├── webapp/                # Next.js frontend application
└── README.md              # This file
```

## Setup & Usage

### 1. Prepare Data

Export your data from the respective platforms and place the unzipped content into the `data/` directory.

**Expected Directory Structure:**

```
data/
├── Facebook/
│   └── your_facebook_activity/
├── Instagram/
│   └── your_instagram_activity/
└── Google Chat/
    └── Groups/
```

### 2. Process Data

You must run the index generation scripts for each platform you want to view. These scripts scan your data and create JSON index files used by the webapp.

**Run All Scripts:**

```bash
# Facebook
python3 scripts/generate_fb_index.py

# Instagram
python3 scripts/generate_ig_index.py

# Google Chat (Also splits large files)
python3 scripts/generate_google_chat_index.py
```

_Note: The Google Chat script performs additional processing to split large message files and deduplicate attachment maps._

**Optional: Batch Extraction**
If you have multiple zip files (e.g. from a multi-part Google Takeout), you can use the helper script to extract them all at once:

```bash
# Extract all zips in the current directory
./scripts/extract_all.sh data/Takeout_Zips/
```

### 3. Run the Viewer

Navigate to the webapp directory and start the dev server:

```bash
cd webapp
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to browse your messages.

## Technical Details

- **Frontend:** [Next.js](https://nextjs.org/) (React), CSS Modules for styling.
- **Backend:** Next.js API Routes (Node.js) serve the local JSON data.
- **Scripts:** Python 3 utilites for data transformation and indexing.

## Latest Updates

- **Google Chat Fixes:** Implemented chronological alignment logic to resolve filename mismatches caused by deleted messages in Takeout archives.
- **UI Polish:** Enhanced contrast for headers and added "Page X of Y" pagination indicators.
