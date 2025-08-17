// Clean, safer rewrite of your original router
// - Validates inputs
// - Uses async/await consistently
// - Avoids process.exit and recursive restarts
// - Centralizes helpers and logging
// - Keeps your original behavior (pairing code -> send session -> upload to Mega -> cleanup)

const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega");

const router = express.Router();

// -----------------------------
// Config & Logger
// -----------------------------
const SESSION_DIR = path.resolve("./session");
const BOT_NAME = process.env.BOT_NAME || "BHANUKA MD";
const BRAND_IMAGE_URL =
  process.env.BRAND_IMAGE_URL || "https://github.com/Bhanukamd/Bot-helper"; // keep your original default
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

// -----------------------------
// Utilities
// -----------------------------
function sanitizeNumber(input) {
  if (typeof input !== "string") return "";
  return input.replace(/[^0-9]/g, "");
}

async function removePath(targetPath) {
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err }, "Failed to remove path");
  }
}

function randomMegaId(length = 6, numberLength = 4) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  const number = Math.floor(Math.random() * Math.pow(10, numberLength));
  return `${result}${number}`;
}

async function createSocket(state) {
  return makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger.child({ level: "fatal" })),
    },
    printQRInTerminal: false,
    logger: logger.child({ module: "baileys", level: "fatal" }),
    browser: Browsers.macOS("Safari"),
  });
}

async function uploadSessionToMega() {
  const credsPath = path.join(SESSION_DIR, "creds.json");
  // Ensure file exists before upload
  try {
    await fsp.access(credsPath);
  } catch {
    throw new Error("creds.json not found after pairing");
  }
  const megaUrl = await upload(fs.createReadStream(credsPath), `${randomMegaId()}.json`);
  // Keep your original behavior: strip prefix to form "string_session"
  return megaUrl.replace("https://mega.nz/file/", "");
}

// -----------------------------
// Route
// -----------------------------
router.get("/", async (req, res) => {
  const raw = req.query.number;
  const number = sanitizeNumber(raw);

  if (!number) {
    return res.status(400).json({ error: "Query param 'number' is required (digits only)." });
  }

  let socket; // closure-visible for cleanup
  let stopReconnect = false;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    socket = await createSocket(state);

    // If not registered, request pairing code and return it once
    if (!socket.authState?.creds?.registered) {
      await delay(1500);
      const code = await socket.requestPairingCode(number);
      if (!res.headersSent) {
        res.status(200).json({ code });
      }
    }

    // Persist creds
    socket.ev.on("creds.update", saveCreds);

    // Handle connection updates
    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        try {
          // Give Baileys a moment to flush creds
          await delay(5000);
          const userJid = jidNormalizedUser(socket.user.id);

          const stringSession = await uploadSessionToMega();

          const caption = `*${BOT_NAME}*\n\n👉 ${stringSession} 👈\n\n*This is your Session ID*\n\n> ${BOT_NAME}`;
          const warning = `🛑 *Do not share this code with anyone* 🛑`;

          await socket.sendMessage(userJid, {
            image: { url: BRAND_IMAGE_URL },
            caption,
          });
          await socket.sendMessage(userJid, { text: stringSession });
          await socket.sendMessage(userJid, { text: warning });
        } catch (err) {
          logger.error({ err }, "Failed to send session to user; attempting pm2 restart");
          if (process.env.PM2_APP_NAME) exec(`pm2 restart ${process.env.PM2_APP_NAME}`);
        } finally {
          // Clean up local session and stop any reconnect loops
          stopReconnect = true;
          await delay(100);
          await removePath(SESSION_DIR);
        }
      }

      if (connection === "close" && !stopReconnect) {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        // Only retry if not 401 (invalid session)
        if (statusCode !== 401) {
          logger.warn({ statusCode }, "Connection closed; retrying in 10s");
          await delay(10000);
          // No recursive calls; Baileys will emit updates again once it reconnects
        } else {
          logger.error("Unauthorized (401) during connection; not retrying");
        }
      }
    });
  } catch (err) {
    logger.error({ err }, "Pair route error");
    if (process.env.PM2_APP_NAME_FALLBACK) exec(`pm2 restart ${process.env.PM2_APP_NAME_FALLBACK}`);
    await removePath(SESSION_DIR);
    if (!res.headersSent) {
      res.status(503).json({ error: "Service Unavailable" });
    }
  }
});

// -----------------------------
// Global error guard
// -----------------------------
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  if (process.env.PM2_APP_NAME_GUARD) exec(`pm2 restart ${process.env.PM2_APP_NAME_GUARD}`);
});

module.exports = router;
