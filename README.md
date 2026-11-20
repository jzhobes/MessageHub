# MessageHub

**MessageHub** is a unified, fully local viewer for personal communication archives. It consolidates message history from Facebook, Instagram, Google Chat, Google Voice, and Gmail into a single, searchable interface without uploading or syncing data to the cloud.

MessageHub also includes **DataForge AI**, a dataset curation studio designed to prepare high-quality training data for fine-tuning language models on an individual’s authentic voice, while keeping all data strictly offline.

---

## 🏁 Getting started

### Requirements

- Node.js 26+ (LTS)
- Python 3.10+
- macOS, Linux, or WSL
  > **Windows setup:** Use WSL (Windows Subsystem for Linux) with Ubuntu, and install Node.js and Python inside Ubuntu.

### First launch

1. Download your archives using the [export checklist below](#data-export-checklist). Keep them as `.zip`, `.tgz`, or `.tar.gz` files—no need to unzip them.
2. From the project folder, run:

   ```bash
   ./start.sh
   ```

   The first launch installs dependencies and builds the app. When ready, it opens [MessageHub](http://localhost:3000) in your browser.
3. Click **Get Started**, confirm a workspace location, and click **Next**.
4. Select your export archives. Leave **Keep Originals** selected to preserve the downloaded files, then click **Next**.
5. Click **Start Processing** and wait for the import to finish. Click **Open MessageHub** to browse your messages.

Your workspace stores the database and extracted messages and media. Keep that folder intact; the original downloaded archives are not needed for browsing after import.

### Importing new data

1. Download your latest exports and open **Setup** (the gear button in MessageHub).
2. Choose **Import**, select the new archives, and click **Confirm**.
3. In **Overview**, click **Start Processing**. When finished, click **Open MessageHub**.

New imports are merged into your existing data. Messages matching an existing conversation, sender, timestamp, and text are skipped; overlapping exports do not require a reset. This is not a guarantee that every duplicate is detected, especially messages without text.

**Keep Originals** preserves downloaded archives. **Delete After Import** deletes the selected originals after successful extraction.

### Stopping and reopening

Press `Control+C` in the terminal running MessageHub to stop it. Run `./start.sh` again to reopen it with your existing workspace.

### Data export checklist

- **Facebook & Instagram:** Select **Messages** and **Profile Information**, and choose **JSON** format. Facebook Posts and Events are optional but supported. [Download Your Information](https://accountscenter.facebook.com/info_and_permissions/dyi)
- **Facebook Messenger encrypted messages:** Download end-to-end encrypted chats separately from the standard Facebook export. Otherwise, exported conversations may stop where end-to-end encryption was enabled.

  1. On desktop, open [Download your message storage data](https://www.facebook.com/secure_storage/dyi).
  2. Keep **Messages** selected. Select **Media** if you also want files, photos, and videos; choose **Higher-quality media** or **Lower-quality media** based on your storage needs.
  3. Set **Date range** to **All time** for the full available history.
  4. Click **Download file**. Facebook prepares the message storage data in **JSON** format; formatting may take several minutes. Complete any authentication prompts and save the download alongside your standard Facebook export.

- **Google Takeout:** Select **Chat**, **Voice**, and **Mail** as needed. For Mail, include **Sent**. [Google Takeout](https://takeout.google.com/)

Include **Profile Information** for Facebook and Instagram so MessageHub can distinguish your messages from other participants.

## Troubleshooting

- **The browser did not open:** Once the terminal says MessageHub is launching, open [localhost:3000](http://localhost:3000) yourself. Keep the terminal running.
- **The importer cannot select your files or finds no supported data:** Select the original `.zip`, `.tgz`, or `.tar.gz` exports and check the [export checklist](#data-export-checklist), especially JSON format for Facebook and Instagram.
- **An import fails:** Check the error in **Overview**, confirm the source archives are still available, and click **Retry**. If it fails again, keep the error text and terminal output for troubleshooting.

---

## ⚙️ Optional configuration

### Instagram link previews (`INSTAGRAM_AUTH`)

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

## 🔧 Maintenance & utilities

Run the following commands from the `webapp/` directory:

- `npm run validate`
  Runs lint fixes, formatting, type checks, and tests.
- `npm run clean:all`
  **Destructive reset:** deletes the Python virtual environment and `data_samples/` folder (including any workspace data stored there), along with the Next.js build output. Use only when you intend to remove that data.

---

## 🧩 Architecture overview

- **Next.js / React** - Local web interface and application server
- **Python** - High-throughput data ingestion and preprocessing
- **SQLite** - Embedded database with full-text search
- **Transformers.js** - In-browser AI for persona and language analysis
