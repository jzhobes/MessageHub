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
│   ├── process_messages.py
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

### 1. Data Export & Prerequisites

#### Exporting Data

**Facebook:**

1. Go to [**Accounts Center** > **Your information and permissions** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2. **Create export** > **Facebook** > **Export to device**
3. **Customize information** (make sure the following are selected)
   - **Your Facebook activity** > **Messages**
   - **Personal information** > **Profile information**
4. **Date range** > **All time** (or any custom range)
5. **Format** > **JSON**
6. **Media quality** > **Higher quality** (optional, but recommended)
7. **Start export**

**Instagram:**

1. Go to [**Accounts Center** > **Your information and permissions** > **Export your information**](https://accountscenter.facebook.com/info_and_permissions/dyi).
2. **Create export** > **Instagram** > **Export to device**
3. **Customize information** (make sure the following are selected)
   - **Your Instagram activity** > **Messages**
   - **Personal information** > **Personal information** & **Information about you**
4. **Date range** > **All time** (or any custom range)
5. **Format** > **JSON**
6. **Media quality** > **Higher quality** (optional, but recommended)
7. **Start export**

**Google:**

1. Go to [Google Takeout](https://takeout.google.com/).
2. Select **Google Chat**.
3. Select **Voice**.
4. Click **Next Step**.
5. Change filze size to 4 GB.
6. Click **Create export**.

#### Environment Setup (.env)

To enable rich link previews for Instagram links (bypassing login walls), you need to provide your Instagram cookies.

1. Go to [Instagram](https://instagram.com).
2. Log in if you haven't already.
3. Open Developer Tools (F12) -> Network Tab.
4. Refresh the page and click on any request to `instagram.com` (should be the first request).
5. Copy the `Cookie` header value, paste it into a temporary file, then look for the **sessionId** and **csrftoken** values.
6. Create a new file called `.env` in the root directory of the project.
7. Copy the values into the `.env` file in the following format:

```bash
INSTAGRAM_AUTH={"sessionid":"<sessionid>","csrftoken":"<csrftoken>"}
```

### 2. Process Data

Run the processing and index generation scripts. The `process_messages.py` script fixes text encoding issues (like mojibake emojis) by creating `.processed.json` files, which the index generators then use to build the JSON indexes.

**Run Scripts:**

```bash
# Fix text encoding (Facebook & Instagram)
python3 scripts/process_messages.py

# Facebook Index
python3 scripts/generate_fb_index.py

# Instagram Index
python3 scripts/generate_ig_index.py

# Google Chat Index (Also splits large files)
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
