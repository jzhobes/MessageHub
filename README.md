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
│   ├── generate_fb_index.py
│   ├── generate_ig_index.py
│   ├── generate_google_chat_index.py
│   ├── split_google_chat_messages.py
│   └── utils.py           # Shared logic (Encoding fixes, parsing)
├── webapp/                # Next.js frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI atoms (MessageItem, LinkPreview)
│   │   ├── sections/      # Major page layout blocks (Sidebar, ChatWindow)
│   │   ├── pages/         # Next.js pages and API routes
│   │   └── styles/        # CSS Modules
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

Run the index generation scripts for each platform. These scripts scan your data, **fix encoding issues** (Latin-1 to UTF-8), and create JSON index files.

**Run Scripts:**

```bash
# Facebook
python3 scripts/generate_fb_index.py

# Instagram
python3 scripts/generate_ig_index.py

# Google Chat (Also splits large files)
python3 scripts/generate_google_chat_index.py
```

_Note: The scripts use a shared `utils.py` to handle common tasks like emoji normalization and text decoding._

### 3. Run the Viewer

Navigate to the webapp directory and start the dev server:

```bash
cd webapp
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to browse your messages.

## Technical Details

- **Frontend:** [Next.js](https://nextjs.org/) (React) with a modular component architecture (`Sidebar`, `ThreadList`, `ChatWindow`).
- **Styling:** CSS Modules with a robust theming system for message bubbles and layouts.
- **Backend:** Next.js API Routes (Node.js) serve the local JSON data.
- **Security:** API endpoints include path traversal protection and input validation.
- **Performance:** Expensive text encoding fixes are handled at the preprocessing layer (Python), ensuring fast UI load times.

## Latest Updates

- **Refactored Architecture:** Split monolithic code into focused components (`ChatWindow`, `ThreadList`) for better maintainability.
- **Encoding Fixes:** Moved Latin-1/UTF-8 decoding logic to Python scripts to fix "mojibake" characters (e.g., broken emojis) permanently.
- **Security Hardening:** Patched potential path traversal vulnerabilities in the API.
- **Google Chat Fixes:** Implemented chronological alignment logic to resolve filename mismatches.
- **UI Polish:** Improved accessibility (keyboard nav), introduced CSS variables, and refined message bubble styling.
