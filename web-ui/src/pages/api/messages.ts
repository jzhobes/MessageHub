import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { threadId, page = '1', platform } = req.query;

  if (!threadId) {
    return res.status(400).json({ error: 'Missing threadId' });
  }

  const threadIdStr = Array.isArray(threadId) ? threadId[0] : threadId;
  const pageStr = Array.isArray(page) ? page[0] : page;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  let inboxPath;
  if (platformStr === 'Facebook') {
    inboxPath = path.join(process.cwd(), '../data/your_facebook_activity/messages/inbox');
  } else if (platformStr === 'Google Chat') {
    inboxPath = path.join(process.cwd(), '../data/Google Chat/Groups');
  } else {
    // Default to FB if undefined but fail if unknown?
    if (!platformStr) {
      inboxPath = path.join(process.cwd(), '../data/your_facebook_activity/messages/inbox');
    } else {
      return res.status(400).json({ error: 'Invalid platform' });
    }
  }

  // Google Chat Handling
  if (platformStr === 'Google Chat') {
    const msgPath = path.join(inboxPath, threadIdStr, 'messages.json');
    console.log(`[Google Chat] Loading messages from: ${msgPath}`);
    try {
      if (!fs.existsSync(msgPath)) {
        console.error(`[Google Chat] File not found: ${msgPath}`);
        return res.status(404).json({ error: 'Message file not found' });
      }
      const data = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
      const rawMessages = data.messages || [];
      console.log(`[Google Chat] Found ${rawMessages.length} raw messages`);

      const googleDateToMs = (dateStr: string) => {
        if (!dateStr) {
          return 0;
        }
        try {
          // "Saturday, July 9, 2022 at 2:03:54 PM UTC"
          const clean = dateStr
            .replace(' at ', ' ')
            .replace(' UTC', '')
            .replace(/\u202f/g, ' ');
          return new Date(clean).getTime();
        } catch (e) {
          return 0;
        }
      };

      const messages = rawMessages.map((m: any) => {
        const ms = googleDateToMs(m.created_date);

        const attached = m.attached_files || [];
        const photos: any[] = [];
        const videos: any[] = [];

        attached.forEach((f: any) => {
          const ext = path.extname(f.export_name).toLowerCase();
          const uri = `Google Chat/Groups/${threadIdStr}/${f.export_name}`;
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            photos.push({ uri });
          } else if (['.mp4', '.mov'].includes(ext)) {
            videos.push({ uri });
          }
        });

        const reactions = (m.reactions || []).map((r: any) => ({
          reaction: r.emoji.unicode,
          actor: 'Unknown',
        }));

        return {
          sender_name: m.creator ? m.creator.name : 'Unknown',
          timestamp_ms: ms,
          content: m.text,
          photos: photos.length > 0 ? photos : undefined,
          videos: videos.length > 0 ? videos : undefined,
          reactions: reactions.length > 0 ? reactions : undefined,
        };
      });

      messages.reverse();

      return res.status(200).json({ messages });
    } catch (e) {
      console.error('Error reading Google Chat messages:', e);
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  }

  // Construct path for FB/IG
  const msgPath = path.join(inboxPath, threadIdStr, `message_${pageStr}.json`);

  try {
    if (!fs.existsSync(msgPath)) {
      return res.status(404).json({ error: 'Message file not found' });
    }

    const fileContents = fs.readFileSync(msgPath, 'utf8');
    const data = JSON.parse(fileContents);

    // Facebook Export Encoding Fix
    const fixString = (str: string) => {
      try {
        let decoded = Buffer.from(str, 'latin1').toString('utf8');
        decoded = decoded.replace(/\u2764(?!\uFE0F)/g, '\u2764\uFE0F');
        return decoded;
      } catch (e) {
        return str;
      }
    };

    const fixRecursive = (obj: any): any => {
      if (typeof obj === 'string') {
        return fixString(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(fixRecursive);
      } else if (obj && typeof obj === 'object') {
        const newObj: any = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = fixRecursive(obj[key]);
          }
        }
        return newObj;
      }
      return obj;
    };

    const fixedData = fixRecursive(data);

    return res.status(200).json(fixedData);
  } catch (error) {
    console.error('Error reading message file:', error);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
}
