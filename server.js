const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const nodemailer = require("nodemailer");

const ROOT = __dirname;
const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const DEFAULT_MAIL_TO = "nextpage@inboxbear.com";
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]]
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, "Форма отправлена в неподдерживаемом формате.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Слишком большой запрос.");
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Не удалось прочитать данные формы.");
  }
}

function validateLead(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Проверьте заполнение формы.");
  }

  const fields = {
    name: ["Имя", 100],
    contact: ["Контакт", 200],
    project: ["Описание задачи", 1500]
  };
  const lead = {};

  for (const [key, [label, maxLength]] of Object.entries(fields)) {
    const value = body[key];
    if (typeof value !== "string") throw new HttpError(400, `Заполните поле «${label}».`);
    const trimmed = value.trim();
    if (!trimmed) throw new HttpError(400, `Заполните поле «${label}».`);
    if (trimmed.length > maxLength) throw new HttpError(400, `Поле «${label}» слишком длинное.`);
    lead[key] = trimmed;
  }

  return lead;
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function formatLeadEmail(lead) {
  return [
    "Новая заявка с сайта Next Page",
    "",
    `Имя: ${lead.name}`,
    `Контакт: ${lead.contact}`,
    "",
    "Задача:",
    lead.project
  ].join("\n");
}

function createMailTransport(env = process.env) {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const password = env.SMTP_PASSWORD;
  if (!host || !user || !password) return null;

  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }

  const secureValue = String(env.SMTP_SECURE || "").toLowerCase();
  if (secureValue && secureValue !== "true" && secureValue !== "false") {
    throw new Error("SMTP_SECURE must be true or false.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: secureValue ? secureValue === "true" : port === 465,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000
  });
}

function createServer({
  mailTransport = createMailTransport(),
  mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER,
  mailTo = process.env.MAIL_TO || DEFAULT_MAIL_TO
} = {}) {
  const rateLimits = new Map();

  return http.createServer(async (request, response) => {
    setSecurityHeaders(response);

    let url;
    try {
      url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    } catch {
      sendJson(response, 400, { error: "Некорректный запрос." });
      return;
    }

    if (url.pathname === "/api/lead") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: "Метод не поддерживается." });
        return;
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Запрос отклонён." });
        return;
      }
      if (!mailTransport || !mailFrom || !mailTo) {
        sendJson(response, 503, { error: "Приём заявок временно не настроен. Попробуйте позже." });
        return;
      }

      const now = Date.now();
      const clientIp = request.socket.remoteAddress || "unknown";
      for (const [ip, limit] of rateLimits) {
        if (now - limit.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(ip);
      }
      const currentLimit = rateLimits.get(clientIp);
      if (currentLimit && now - currentLimit.startedAt < RATE_LIMIT_WINDOW_MS && currentLimit.count >= RATE_LIMIT_MAX) {
        sendJson(response, 429, { error: "Слишком много заявок. Попробуйте позже." });
        return;
      }
      if (!currentLimit || now - currentLimit.startedAt >= RATE_LIMIT_WINDOW_MS) {
        rateLimits.set(clientIp, { startedAt: now, count: 1 });
      } else {
        currentLimit.count += 1;
      }

      try {
        const lead = validateLead(await readJsonBody(request));
        const delivery = await mailTransport.sendMail({
          from: mailFrom,
          to: mailTo,
          subject: "Новая заявка с сайта Next Page",
          text: formatLeadEmail(lead)
        });

        if (!delivery || delivery.rejected?.length || (Array.isArray(delivery.accepted) && delivery.accepted.length === 0)) {
          console.error("SMTP did not accept the lead notification.");
          sendJson(response, 502, { error: "Не удалось доставить заявку на почту. Попробуйте позже." });
          return;
        }

        sendJson(response, 200, { ok: true });
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(response, error.status, { error: error.message });
          return;
        }

        const errorCode = error instanceof Error && typeof error.code === "string" ? error.code : error instanceof Error ? error.name : "UnknownError";
        console.error("Email delivery failed:", errorCode);
        sendJson(response, 502, { error: "Не удалось доставить заявку на почту. Попробуйте позже." });
      }
      return;
    }

    const file = STATIC_FILES.get(url.pathname);
    if (!file || (request.method !== "GET" && request.method !== "HEAD")) {
      sendJson(response, 404, { error: "Страница не найдена." });
      return;
    }

    try {
      const content = await fs.readFile(path.join(ROOT, file[0]));
      response.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": file[0] === "index.html" ? "no-store" : "public, max-age=300"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      console.error("Failed to read site file:", file[0], error instanceof Error ? error.code : "UnknownError");
      sendJson(response, 500, { error: "Не удалось загрузить страницу." });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be a valid TCP port.");
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.listen(port, "0.0.0.0", () => {
      console.log(`Next Page is available at http://localhost:${port}`);
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
        console.warn("Email delivery is disabled until SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are configured.");
      }
    });
  }
}

module.exports = { createMailTransport, createServer };
