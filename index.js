import { Client, GatewayIntentBits, Partials } from "discord.js";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

/* ========== CONFIG ========== */

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const REMINDER_SUFFIX = process.env.REMINDER_SUFFIX || "Send march!";
const ROLE_ID = "1470030804653445212";

if (!TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!CHANNEL_ID) throw new Error("Missing ANNOUNCE_CHANNEL_ID");

const PREFIX = "-";
const TZ = "UTC";

/* ============================ */

const DIR = path.join(process.cwd(), "schedules");
const RUINS = path.join(DIR, "ruins.txt");
const ALTAR = path.join(DIR, "altar.txt");
const STATE = path.join(process.cwd(), "state.json");

let state = (() => {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); }
  catch { return { notified: {} }; }
})();

let events = [];

const hasRole = (m) => !!m?.roles?.cache?.has(ROLE_ID);
const fmt = (dt) => dt.toUTC().toFormat("ccc dd.LL HH:mm 'UTC'");
const norm = (s) => s.trim().replace(/\s+/g, " ").replace(/^[A-Za-z]{3},\s*/g, "");

function parseLine(line) {
  const s = norm(line);
  if (!s || s.startsWith("#")) return null;

  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const [_, d, mo, h, mi] = m.map(Number);
  const now = DateTime.now().setZone(TZ);

  let dt = DateTime.fromObject(
    { year: now.year, month: mo, day: d, hour: h, minute: mi },
    { zone: TZ }
  );

  if (dt < now.minus({ minutes: 5 })) dt = dt.plus({ years: 1 });
  return dt;
}

function readSchedule(file, type) {
  if (!fs.existsSync(file)) return [];
  const seen = new Set();
  const out = [];

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const dt = parseLine(line);
    if (!dt) continue;

    const key = `${type}:${dt.toISO()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ type, startsAt: dt, key });
  }

  return out.sort((a, b) => a.startsAt - b.startsAt);
}

function saveState() {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), "utf8");
}

function loadAll() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  events = [
    ...readSchedule(RUINS, "ruins"),
    ...readSchedule(ALTAR, "altar")
  ].sort((a, b) => a.startsAt - b.startsAt);

  const cutoff = DateTime.now().setZone(TZ).minus({ days: 14 });
  for (const k of Object.keys(state.notified)) {
    const iso = k.split(":")[1];
    const t = DateTime.fromISO(iso, { zone: TZ });
    if (t.isValid && t < cutoff) delete state.notified[k];
  }

  saveState();
  console.log(`[INFO] Loaded ${events.length} events`);
}

async function sendReminder(client, ev) {
  const ch = await client.channels.fetch(CHANNEL_ID);
  if (!ch?.isTextBased()) return;

  const label = ev.type === "ruins" ? "Ruins" : "Altar";
  await ch.send(`@everyone ${label} in 1 hour! ${REMINDER_SUFFIX}`);

  state.notified[ev.key] = true;
  saveState();
}

async function tick(client) {
  const now = DateTime.now().setZone(TZ);
  for (const ev of events) {
    if (state.notified[ev.key]) continue;
    const diff = ev.startsAt.diff(now, "seconds").seconds;
    if (diff >= 3570 && diff <= 3630) await sendReminder(client, ev);
  }
}

function helpText() {
  return [
    "**Ruins / Altar Bot (UTC)**",
    "",
    "`-help` — show this help",
    "`-status` — next upcoming event",
    "`-week` — events in next 7 days",
    "`-month` — events in next 1 month",
    "`-reload` — reload schedules",
    "",
    "Only users with the correct role can use commands."
  ].join("\n");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;
  if (!hasRole(msg.member)) return;

  const cmd = msg.content.slice(1).trim().toLowerCase();
  const now = DateTime.now().setZone(TZ);

  if (cmd === "help") return msg.reply(helpText());

  if (cmd === "reload") {
    loadAll();
    return msg.reply("✅ Reloaded schedules (UTC).");
  }

  if (cmd === "status") {
    const n = events.find(e => e.startsAt >= now);
    if (!n) return msg.reply("No upcoming events.");
    return msg.reply(`Next **${n.type.toUpperCase()}** at **${fmt(n.startsAt)}**`);
  }

  if (cmd === "week") {
    const end = now.plus({ days: 7 });
    const list = events.filter(e => e.startsAt >= now && e.startsAt <= end);
    return msg.reply(list.length
      ? list.map(e => `• **${e.type.toUpperCase()}** — ${fmt(e.startsAt)}`).join("\n")
      : "No events in next 7 days.");
  }

  if (cmd === "month") {
    const end = now.plus({ months: 1 });
    const list = events.filter(e => e.startsAt >= now && e.startsAt <= end);
    return msg.reply(list.length
      ? list.map(e => `• **${e.type.toUpperCase()}** — ${fmt(e.startsAt)}`).join("\n")
      : "No events in next 1 month.");
  }
});

client.once("ready", () => {
  console.log(`[INFO] Logged in as ${client.user.tag}`);
  loadAll();
  setInterval(() => tick(client).catch(console.error), 30_000);
});

client.login(TOKEN);

// EOF
