# Fictional demo archive

The five ZIPs are native-format exports for one fictional account owner, **Alex Smith**, covering January–June 2025. People, businesses, addresses, purchases, and events are invented. Email addresses use `example.com`; telephone numbers use the reserved fictional 202-555-01xx range.

The readable editorial source is [source/conversations.txt](source/conversations.txt). Each `##` header defines a platform, stable slug, title, and participants. `@` lines start a dated exchange in UTC; sender initials are defined at the top of the file. Messages within an exchange are spaced 83 seconds apart. The generator adds native export metadata, a few reactions, multipart email, and five original illustrated-note or text attachments. It has no third-party media dependencies. Casual chats mix lowercase, fragments, and normal sentences by person: Alex is relaxed with friends, Sam mostly writes lowercase, David keeps texts brief, and Susan uses standard capitalization. Work chats and email retain normal capitalization.

To regenerate the archives from the repository root:

```sh
python3 scripts/generate_samples.py
./build_samples.sh
node webapp/scripts/export-demo-data.mjs
```

The first command replaces the five tracked ZIPs reproducibly. The second replaces the ignored `data_samples/` workspace; the third refreshes the ignored `webapp/public/demo/` bundle. No deployment is performed.

## Pagination examples

Content pages contain 100 messages. The dataset has 680 messages across 23 conversations, with three longer threads for trying page navigation and jumps to older search results:

| Conversation | Messages | Pages |
| --- | ---: | ---: |
| Field Notes launch (Google Chat) | 222 | 3 |
| Emma Wilson (Facebook DM) | 112 | 2 |
| Field Notes refresh — agreed scope (Gmail) | 104 | 2 |

The work threads follow the initial audit through launch and June handover. Emma's DM follows recurring coffee plans, books, the cabin trip, and concert arrangements. Other conversations stay short. This exercises message pagination; it does not add extra conversations for thread-list pagination.

## Things to explore

- **Fern House:** Find the final pickup time, cabin address, arrival instructions, grocery split, and forgotten charger across Facebook, Voice, and email.
- **Lemon lentil soup:** Follow a family recipe from email to friends and back to a later family conversation.
- **Field Notes:** Trace the January scope, mobile review, April launch, and support follow-up across Chat and email.
- **W4821:** Find a keyboard receipt, return reference R219, and the full $70 refund.
- **Harbor Lights:** Connect tickets, dinner reservation, a delayed train, and the late-night trip home.
- **Everyday continuity:** Pottery class and pickup, David's move, balcony tomatoes, book loans, and recurring coffee plans.

Keep malformed exports, intentional duplicates, and encoding regression cases in test fixtures rather than adding them to this demo.
