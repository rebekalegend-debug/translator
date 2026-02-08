import { Client, GatewayIntentBits, Partials } from "discord.js";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

const TOKEN = process.env.DISCORD_TOKEN;
const CH_ID = process.env.ANNOUNCE_CHANNEL_ID;
const SUFFIX = process.env.REMINDER_SUFFIX || "Send march!";
const ROLE_ID = "1470030804653445212";
if (!TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!CH_ID) throw new Error("Missing ANNOUNCE_CHANNEL_ID");

const TZ = "UTC";
const DIR = path.join(process.cwd(), "schedules");
const F_R = path.join(DIR, "ruins.txt");
const F_A = path.join(DIR, "altar.txt");
const STATE = path.join(process.cwd(), "state.json");
let state = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { notified: {} }; } })();
let events = [];

const hasRole = (m) => !!m?.roles?.cache?.has(ROLE_ID);
const norm = (s) => s.trim().replace(/\s+/g, " ").replace(/^[A-Za-z]{3},\s*/g, "");
const fmt = (dt) => dt.toUTC().toFormat("ccc dd.LL HH:mm 'UTC'");

function parseLine(line) {
  const s = norm(line);
  if (!s || s.startsWith("#")) return null;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const day = +m[1], month = +m[2], hour = +m[3], minute = +m[4];
  const now = DateTime.now().setZone(TZ);
  let dt = DateTime.fromObject({ year: now.year, month, day, hour, minute }, { zone: TZ });
  if (dt < now.minus({ minutes: 5 })) dt = dt.plus({ years: 1 });
  return dt;
}

function readFile(file, type) {
  if (!fs.existsSync(file)) return [];
  const seen = new Set(), out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const dt = parseLine(line);
    if (!dt) continue;
    const key = `${type}:${dt.toISO()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, startsAt: dt, key });
  }
  return out.sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis());
}

function saveState() { fs.writeFileSync(STATE, JSON.stringify(state, null, 2), "utf8"); }

function loadAll() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  events = [...readFile(F_R, "ruins"), ...readFile(F_A, "altar")].sort((a, b) => a.startsAt - b.startsAt);
  const cutoff = DateTime.now().setZone(TZ).minus({ days: 14 });
  for (const k of Object.keys(state.notified)) {
    const iso = k.split(":").slice(1).join(":");
    const t = DateTime.fromISO(iso, { zone: TZ });
    if (t.isValid && t < cutoff) delete state.notified[k];
  }
  saveState();
  console.log(`[INFO] Loaded ${events.length} events (UTC)`);
}

async function warn(client, ev) {
  const ch = await client.channels.fetch(CH_ID);
  if (!ch?.isTextBased()) return;
  const label = ev.type === "ruins" ? "Ruins" : "Altar";
  await ch.send(`@everyone ${label} in 1 hour! ${SUFFIX}`);
  state.notified[ev.key] = true;
  saveState();
  console.log(`[INFO] Warned ${ev.key}`);
}

async function tick(client) {
  const now = DateTime.now().setZone(TZ);
  for (const ev of events) {
    if (state.notified[ev.key]) continue;
    const diff = ev.startsAt.diff(now, "seconds").seconds;
    if (diff >= 3570 && diff <= 3630) await warn(client, ev);
  }
}

const help = () => [
  "**Ruins/Altar Bot (UTC)**",
  "`!!help` (role only)",
  "`!status` `!week` `!month` `!reload` (role only)"
].join("\n");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  if (msg.content.trim() === "!!help") {
    if (!hasRole(msg.member)) return;
    return msg.reply(help());
  }

  if (!msg.content.startsWith("!")) return;
  if (!hasRole(msg.member)) return;

  const cmd = msg.content.slice(1).trim().toLowerCase();
  const now = DateTime.now().setZone(TZ);

  if (cmd === "reload") { loadAll(); return msg.reply("✅ Reloaded schedules (UTC)."); }
  if (cmd === "status") {
    const n = events.find(e => e.startsAt >= now);
    if (!n) return msg.reply("No upcoming events.");
    return msg.reply(`Next **${n.type.toUpperCase()}** at **${fmt(n.startsAt)}**`);
  }
  if (cmd === "week") {
    const end = now.plus({ days: 7 });
    const list = events.filter(e => e.startsAt >= now && e.startsAt <= end).slice(0, 50);
    return msg.reply(list.length ? list.map(e => `• ${e.type.toUpperCase()} — ${fmt(e.startsAt)}`).join("\n") : "No events in next 7 days.");
  }
  if (cmd === "month") {
    const end = now.plus({ months: 1 });
    const list = events.filter(e => e.startsAt >= now && e.startsAt <= end).slice(0, 50);
    return msg.reply(list.length ? list.map(e => `• ${e.type.toUpperCase()} — ${fmt(e.startsAt)}`).join("\n") : "No events in next 1 month.");
  }
});

client.once("ready", () => {
  console.log(`[INFO] Logged in as ${client.user.tag}`);
  loadAll();
  setInterval(() => tick(client).catch(e => console.error("[ERROR] tick", e)), 30_000);
});

client.login(TOKEN);

// EOF
