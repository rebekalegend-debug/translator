import { Client, GatewayIntentBits, Partials } from "discord.js";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

/* ================= CONFIG ================= */

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;

const TIMEZONE = "UTC";
const PREFIX = "!";
const REMINDER_SUFFIX = process.env.REMINDER_SUFFIX || "Send march!";
const COMMAND_ROLE_ID = "1470030804653445212";

/* ========================================= */

if (!DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!ANNOUNCE_CHANNEL_ID) throw new Error("Missing ANNOUNCE_CHANNEL_ID");

const SCHEDULE_DIR = path.join(process.cwd(), "schedules");
const RUINS_FILE = path.join(SCHEDULE_DIR, "ruins.txt");
const ALTAR_FILE = path.join(SCHEDULE_DIR, "altar.txt");
const STATE_FILE = path.join(process.cwd(), "state.json");

/* ================= STATE ================= */

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { notified: {} };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
let state = loadState();

/* ================= UTILS ================= */

function hasCommandRole(member) {
  return member?.roles?.cache?.has(COMMAND_ROLE_ID);
}

function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ").replace(/^[A-Za-z]{3},\s*/g, "");
}

function parseDateUTC(line) {
  const s = normalizeLine(line);
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const [_, d, mo, h, mi] = m.map(Number);
  const now = DateTime.now().setZone(TIMEZONE);

  let dt = DateTime.fromObject(
    { year: now.year, month: mo, day: d, hour: h, minute: mi },
    { zone: TIMEZONE }
  );

  if (dt < now.minus({ minutes: 5 })) dt = dt.plus({ years: 1 });
  return dt;
}

function fmtUTC(dt) {
  return dt.toUTC().toFormat("ccc dd.LL HH:mm 'UTC'");
}

/* ================= SCHEDULE ================= */

let events = [];

function readSchedule(file, type) {
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, "utf8").split("\n");
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const dt = parseDateUTC(line);
    if (!dt) continue;

    const key = `${type}:${dt.toISO()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ type, startsAt: dt, key });
  }

  return out.sort((a, b) => a.startsAt - b.startsAt);
}

function loadAllEvents() {
  if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });

  events = [
    ...readSchedule(RUINS_FILE, "ruins"),
    ...readSchedule(ALTAR_FILE, "altar")
  ].sort((a, b) => a.startsAt - b.startsAt);

  const now = DateTime.now().toUTC();
  for (const k in state.notifie
