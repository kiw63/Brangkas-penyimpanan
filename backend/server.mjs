"use strict";

/*
============================================================
BRANKAS BACKEND
============================================================

Runtime:
- Node.js 20+
- Express
- PostgreSQL
- Cloudflare R2 / S3-compatible storage
- Argon2id password hashing

Environment variables wajib:
- DATABASE_URL
- SESSION_SECRET
- REDEEM_CODE
- R2_ENDPOINT
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_BUCKET

Opsional:
- PORT
- FRONTEND_ORIGIN
- ALLOW_YTDLP
- MAX_FILE_SIZE_BYTES
*/

import express from "express";
import helmet from "helmet";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import argon2 from "argon2";
import pg from "pg";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from "@aws-sdk/client-s3";

import {
  getSignedUrl
} from "@aws-sdk/s3-request-presigner";


/* ============================================================
   CONFIG
   ============================================================ */

const {
  Pool
} = pg;

const PORT =
  Number(
    process.env.PORT || 8787
  );

const DATABASE_URL =
  process.env.DATABASE_URL;

const SESSION_SECRET =
  process.env.SESSION_SECRET;

const REDEEM_CODE =
  process.env.REDEEM_CODE;

const R2_ENDPOINT =
  process.env.R2_ENDPOINT;

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID;

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY;

const R2_BUCKET =
  process.env.R2_BUCKET;

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "*";

const ALLOW_YTDLP =
  process.env.ALLOW_YTDLP === "1";

const MAX_FILE_SIZE =
  Number(
    process.env.MAX_FILE_SIZE_BYTES ||
    5 * 1024 * 1024 * 1024
  );

const SESSION_TTL =
  30 * 60 * 1000;


/* ============================================================
   STARTUP VALIDATION
   ============================================================ */

const requiredEnvironment = [
  [
    "DATABASE_URL",
    DATABASE_URL
  ],
  [
    "SESSION_SECRET",
    SESSION_SECRET
  ],
  [
    "REDEEM_CODE",
    REDEEM_CODE
  ],
  [
    "R2_ENDPOINT",
    R2_ENDPOINT
  ],
  [
    "R2_ACCESS_KEY_ID",
    R2_ACCESS_KEY_ID
  ],
  [
    "R2_SECRET_ACCESS_KEY",
    R2_SECRET_ACCESS_KEY
  ],
  [
    "R2_BUCKET",
    R2_BUCKET
  ]
];

const missingEnvironment =
  requiredEnvironment
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([name]) =>
        name
    );

if (
  missingEnvironment.length
) {

  console.error(
    "Missing environment variables:",
    missingEnvironment.join(", ")
  );

  process.exit(1);

}


/* ============================================================
   DATABASE
   ============================================================ */

const pool =
  new Pool({
    connectionString:
      DATABASE_URL,

    ssl:
      DATABASE_URL.includes(
        "localhost"
      )
        ? false
        : {
            rejectUnauthorized:
              false
          },

    max: 5,

    idleTimeoutMillis:
      30_000,

    connectionTimeoutMillis:
      10_000
  });


/* ============================================================
   OBJECT STORAGE
   ============================================================ */

const s3 =
  new S3Client({
    region: "auto",

    endpoint:
      R2_ENDPOINT,

    credentials: {
      accessKeyId:
        R2_ACCESS_KEY_ID,

      secretAccessKey:
        R2_SECRET_ACCESS_KEY
    }
  });


/* ============================================================
   EXPRESS
   ============================================================ */

const app =
  express();

app.disable(
  "x-powered-by"
);


/* ============================================================
   SECURITY HEADERS
   ============================================================ */

app.use(
  helmet({
    contentSecurityPolicy: false,

    crossOriginEmbedderPolicy:
      false
  })
);


/* ============================================================
   CORS
   ============================================================ */

app.use(
  (req, res, next) => {

    const origin =
      req.headers.origin;

    if (
      FRONTEND_ORIGIN === "*"
    ) {

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

    } else if (
      origin &&
      isAllowedOrigin(origin)
    ) {

      res.setHeader(
        "Access-Control-Allow-Origin",
        origin
      );

      res.setHeader(
        "Vary",
        "Origin"
      );

    }

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,DELETE,OPTIONS"
    );

    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition, Content-Length, Content-Type"
    );

    if (
      req.method === "OPTIONS"
    ) {

      res.status(204).end();

      return;

    }

    next();

  }
);


/* ============================================================
   BODY PARSER
   ============================================================ */

app.use(
  express.json({
    limit: "1mb"
  })
);


/* ============================================================
   SIMPLE RATE LIMITER
   ============================================================ */

const rateBuckets =
  new Map();

function rateLimit(
  options = {}
) {

  const windowMs =
    Number(
      options.windowMs ||
      60_000
    );

  const max =
    Number(
      options.max ||
      60
    );

  return (
    req,
    res,
    next
  ) => {

    const key =
      getClientKey(req);

    const now =
      Date.now();

    let bucket =
      rateBuckets.get(key);

    if (
      !bucket ||
      now >= bucket.resetAt
    ) {

      bucket = {
        count: 0,
        resetAt:
          now + windowMs
      };

      rateBuckets.set(
        key,
        bucket
      );

    }

    bucket.count += 1;

    if (
      bucket.count > max
    ) {

      res.status(429).json({
        message:
          "Terlalu banyak request. Coba lagi nanti."
      });

      return;

    }

    next();

  };

}


/* ============================================================
   RATE LIMIT CLEANUP
   ============================================================ */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        key,
        bucket
      ]
      of rateBuckets
    ) {

      if (
        now >= bucket.resetAt
      ) {

        rateBuckets.delete(
          key
        );

      }

    }

  },
  5 * 60 * 1000
).unref();


/* ============================================================
   DATABASE INITIALIZATION
   ============================================================ */

async function initializeDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id UUID PRIMARY KEY,
      original_name TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      source TEXT NOT NULL DEFAULT 'upload',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS files_created_at_idx
    ON files (created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
    ON sessions (expires_at);
  `);

}


/* ============================================================
   SESSION HELPERS
   ============================================================ */

function hashToken(
  token
) {

  return crypto
    .createHmac(
      "sha256",
      SESSION_SECRET
    )
    .update(token)
    .digest("hex");

}


function createRandomToken() {

  return crypto.randomBytes(
    48
  ).toString("base64url");

}


async function createSession() {

  const token =
    createRandomToken();

  const tokenHash =
    hashToken(token);

  const sessionId =
    crypto.randomUUID();

  const expiresAt =
    new Date(
      Date.now() +
      SESSION_TTL
    );

  await pool.query(
    `
      INSERT INTO sessions
      (
        id,
        token_hash,
        expires_at
      )
      VALUES
      ($1, $2, $3)
    `,
    [
      sessionId,
      tokenHash,
      expiresAt
    ]
  );

  return {
    token,
    expiresAt:
      expiresAt.getTime()
  };

}


/* ============================================================
   AUTH MIDDLEWARE
   ============================================================ */

async function requireAuth(
  req,
  res,
  next
) {

  try {

    const authorization =
      req.headers.authorization ||
      "";

    const match =
      authorization.match(
        /^Bearer\s+(.+)$/i
      );

    if (!match) {

      res.status(401).json({
        message:
          "Session diperlukan."
      });

      return;

    }

    const token =
      match[1];

    const tokenHash =
      hashToken(token);

    const result =
      await pool.query(
        `
          SELECT
            id,
            expires_at
          FROM sessions
          WHERE token_hash = $1
          LIMIT 1
        `,
        [
          tokenHash
        ]
      );

    if (
      result.rows.length === 0
    ) {

      res.status(401).json({
        message:
          "Session tidak valid."
      });

      return;

    }

    const session =
      result.rows[0];

    const expiresAt =
      new Date(
        session.expires_at
      );

    if (
      Date.now() >=
      expiresAt.getTime()
    ) {

      await pool.query(
        `
          DELETE FROM sessions
          WHERE id = $1
        `,
        [
          session.id
        ]
      );

      res.status(401).json({
        message:
          "Session telah berakhir."
      });

      return;

    }

    req.sessionId =
      session.id;

    req.tokenHash =
      tokenHash;

    next();

  } catch (error) {

    console.error(
      "Auth error:",
      error
    );

    res.status(500).json({
      message:
        "Gagal memeriksa session."
    });

  }

}


/* ============================================================
   STATUS
   ============================================================ */

app.get(
  "/api/status",
  rateLimit({
    windowMs:
      60_000,

    max:
      30
  }),
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
            SELECT id
            FROM settings
            WHERE id = 1
            LIMIT 1
          `
        );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.json({
        initialized:
          result.rows.length > 0,

        storage:
          "r2"
      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        message:
          "Database tidak tersedia."
      });

    }

  }
);


/* ============================================================
   SETUP
   ============================================================ */

app.post(
  "/api/setup",
  rateLimit({
    windowMs:
      10 * 60 * 1000,

    max:
      5
  }),
  async (
    req,
    res
  ) => {

    try {

      const {
        password,
        redeem
      } =
        req.body || {};

      if (
        typeof password !==
        "string" ||
        password.length < 12
      ) {

        res.status(400).json({
          message:
            "Password minimal 12 karakter."
        });

        return;

      }

      if (
        typeof redeem !==
        "string" ||
        redeem.length < 8
      ) {

        res.status(400).json({
          message:
            "Redeem code tidak valid."
        });

        return;

      }

      if (
        !safeEqual(
          redeem,
          REDEEM_CODE
        )
      ) {

        res.status(403).json({
          message:
            "Redeem code salah."
        });

        return;

      }

      const existing =
        await pool.query(
          `
            SELECT id
            FROM settings
            WHERE id = 1
            LIMIT 1
          `
        );

      if (
        existing.rows.length
      ) {

        res.status(409).json({
          message:
            "BRANKAS sudah di-setup."
        });

        return;

      }

      const passwordHash =
        await argon2.hash(
          password,
          {
            type:
              argon2.argon2id,

            memoryCost:
              19456,

            timeCost:
              2,

            parallelism:
              1
          }
        );

      await pool.query(
        `
          INSERT INTO settings
          (
            id,
            password_hash
          )
          VALUES
          (
            1,
            $1
          )
        `,
        [
          passwordHash
        ]
      );

      res.status(201).json({
        message:
          "BRANKAS berhasil dibuat."
      });

    } catch (error) {

      console.error(
        "Setup error:",
        error
      );

      res.status(500).json({
        message:
          "Gagal membuat BRANKAS."
      });

    }

  }
);


/* ============================================================
   LOGIN
   ============================================================ */

app.post(
  "/api/login",
  rateLimit({
    windowMs:
      10 * 60 * 1000,

    max:
      10
  }),
  async (
    req,
    res
  ) => {

    try {

      const {
        password
      } =
        req.body || {};

      if (
        typeof password !==
        "string" ||
        !password
      ) {

        res.status(400).json({
          message:
            "Password diperlukan."
        });

        return;

      }

      const result =
        await pool.query(
          `
            SELECT
              password_hash
            FROM settings
            WHERE id = 1
            LIMIT 1
          `
        );

      if (
        result.rows.length === 0
      ) {

        res.status(409).json({
          message:
            "BRANKAS belum di-setup."
        });

        return;

      }

      const valid =
        await argon2.verify(
          result.rows[0].password_hash,
          password
        );

      if (!valid) {

        res.status(401).json({
          message:
            "Password salah."
        });

        return;

      }

      const session =
        await createSession();

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.json({
        token:
          session.token,

        expiresAt:
          session.expiresAt
      });

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        message:
          "Gagal login."
      });

    }

  }
);


/* ============================================================
   FILE LIST
   ============================================================ */

app.get(
  "/api/files",
  requireAuth,
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
            SELECT
              id,
              original_name,
              mime_type,
              size,
              source,
              created_at
            FROM files
            ORDER BY created_at DESC
          `
        );

      const files =
        result.rows.map(
          (row) => ({
            id:
              row.id,

            name:
              row.original_name,

            mimeType:
              row.mime_type,

            size:
              Number(
                row.size
              ),

            source:
              row.source,

            createdAt:
              row.created_at
          })
        );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.json({
        files
      });

    } catch (error) {

      console.error(
        "File list error:",
        error
      );

      res.status(500).json({
        message:
          "Gagal mengambil daftar file."
      });

    }

  }
);


/* ============================================================
   MULTIPART UPLOAD
   ============================================================ */

app.post(
  "/api/files",
  requireAuth,
  async (
    req,
    res
  ) => {

    try {

      const contentLength =
        Number(
          req.headers[
            "content-length"
          ] || 0
        );

      if (
        contentLength >
        MAX_FILE_SIZE
      ) {

        res.status(413).json({
          message:
            "File terlalu besar."
        });

        return;

      }

      /*
        Browser mengirim multipart/form-data.

        Kita parsing multipart sederhana
        tanpa menyimpan file ke disk.

        Untuk deployment produksi dengan
        file multi-GB, presigned multipart
        upload ke R2 lebih disarankan.

        Endpoint ini tetap disediakan
        sebagai jalur sederhana.
      */

      const contentType =
        String(
          req.headers[
            "content-type"
          ] || ""
        );

      if (
        !contentType
          .toLowerCase()
          .startsWith(
            "multipart/form-data"
          )
      ) {

        res.status(415).json({
          message:
            "Upload harus menggunakan multipart/form-data."
        });

        return;

      }

      const boundary =
        extractBoundary(
          contentType
        );

      if (!boundary) {

        res.status(400).json({
          message:
            "Multipart boundary tidak ditemukan."
        });

        return;

      }

      const file =
        await parseSingleMultipartFile(
          req,
          boundary,
          MAX_FILE_SIZE
        );

      if (!file) {

        res.status(400).json({
          message:
            "File tidak ditemukan."
        });

        return;

      }

      const id =
        crypto.randomUUID();

      const safeName =
        sanitizeFilename(
          file.filename
        );

      const objectKey =
        createObjectKey(
          id,
          safeName
        );

      await s3.send(
        new PutObjectCommand({
          Bucket:
            R2_BUCKET,

          Key:
            objectKey,

          Body:
            file.data,

          ContentType:
            file.contentType ||
            "application/octet-stream",

          ContentLength:
            file.data.length,

          Metadata: {
            originalname:
              safeMetadataValue(
                file.filename
              )
          }
        })
      );

      await pool.query(
        `
          INSERT INTO files
          (
            id,
            original_name,
            object_key,
            mime_type,
            size,
            source
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            'upload'
          )
        `,
        [
          id,
          file.filename,
          objectKey,
          file.contentType ||
            "application/octet-stream",
          file.data.length
        ]
      );

      res.status(201).json({
        message:
          "File berhasil disimpan.",

        file: {
          id,
          name:
            file.filename,

          mimeType:
            file.contentType ||
            "application/octet-stream",

          size:
            file.data.length
        }
      });

    } catch (error) {

      console.error(
        "Upload error:",
        error
      );

      res.status(500).json({
        message:
          "Gagal mengupload file."
      });

    }

  }
);


/* ============================================================
   FILE PREVIEW
   ============================================================ */

app.get(
  "/api/files/:id",
  requireAuth,
  async (
    req,
    res
  ) => {

    try {

      const file =
        await getFileById(
          req.params.id
        );

      if (!file) {

        res.status(404).json({
          message:
            "File tidak ditemukan."
        });

        return;

      }

      const range =
        req.headers.range;

      const commandInput = {
        Bucket:
          R2_BUCKET,

        Key:
          file.object_key
      };

      /*
        Range support penting untuk
        video/audio besar.
      */

      if (range) {

        const parsedRange =
          parseRange(
            range,
            Number(file.size)
          );

        if (!parsedRange) {

          res.status(416).setHeader(
            "Content-Range",
            `bytes */${file.size}`
          );

          res.end();

          return;

        }

        commandInput.Range =
          `bytes ${parsedRange.start}-${parsedRange.end}`;

      }

      const result =
        await s3.send(
          new GetObjectCommand(
            commandInput
          )
        );

      res.setHeader(
        "Content-Type",
        file.mime_type
      );

      res.setHeader(
        "Accept-Ranges",
        "bytes"
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      if (
        range
      ) {

        const parsedRange =
          parseRange(
            range,
            Number(file.size)
          );

        res.status(
          206
        );

        res.setHeader(
          "Content-Range",
          `bytes ${parsedRange.start}-${parsedRange.end}/${file.size}`
        );

        res.setHeader(
          "Content-Length",
          String(
            parsedRange.end -
            parsedRange.start +
            1
          )
        );

      } else {

        res.setHeader(
          "Content-Length",
          String(
            file.size
          )
        );

      }

      if (
        result.Body
      ) {

        result.Body.pipe(
          res
        );

      } else {

        res.end();

      }

    } catch (error) {

      console.error(
        "Preview error:",
        error
      );

      if (
        !res.headersSent
      ) {

        res.status(404).json({
          message:
            "File tidak dapat dibuka."
        });

      }

    }

  }
);


/* ============================================================
   FILE DOWNLOAD
   ============================================================ */

app.get(
  "/api/files/:id/download",
  requireAuth,
  async (
    req,
    res
  ) => {

    try {

      const file =
        await getFileById(
          req.params.id
        );

      if (!file) {

        res.status(404).json({
          message:
            "File tidak ditemukan."
        });

        return;

      }

      /*
        Kita stream melalui backend supaya
        Authorization tetap diwajibkan.
      */

      const result =
        await s3.send(
          new GetObjectCommand({
            Bucket:
              R2_BUCKET,

            Key:
              file.object_key,

            ResponseContentType:
              file.mime_type,

            ResponseContentDisposition:
              contentDisposition(
                file.original_name
              )
          })
        );

      res.setHeader(
        "Content-Type",
        file.mime_type
      );

      res.setHeader(
        "Content-Length",
        String(
          file.size
        )
      );

      res.setHeader(
        "Content-Disposition",
        contentDisposition(
          file.original_name
        )
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      if (
        result.Body
      ) {

        result.Body.pipe(
          res
        );

      } else {

        res.end();

      }

    } catch (error) {

      console.error(
        "Download error:",
        error
      );

      if (
        !res.headersSent
      ) {

        res.status(404).json({
          message:
            "File gagal didownload."
        });

      }

    }

  }
);


/* ============================================================
   DELETE FILE
   ============================================================ */

app.delete(
  "/api/files/:id",
  requireAuth,
  async (
    req,
    res
  ) => {

    try {

      const file =
        await getFileById(
          req.params.id
        );

      if (!file) {

        res.status(404).json({
          message:
            "File tidak ditemukan."
        });

        return;

      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket:
            R2_BUCKET,

          Key:
            file.object_key
        })
      );

      await pool.query(
        `
          DELETE FROM files
          WHERE id = $1
        `,
        [
          file.id
        ]
      );

      res.json({
        message:
          "File berhasil dihapus."
      });

    } catch (error) {

      console.error(
        "Delete error:",
        error
      );

      res.status(500).json({
        message:
          "Gagal menghapus file."
      });

    }

  }
);


/* ============================================================
   VID3Y IMPORT
   ============================================================ */

app.post(
  "/api/import/vid3y",
  requireAuth,
  rateLimit({
    windowMs:
      60_000,

    max:
      10
  }),
  async (
    req,
    res
  ) => {

    try {

      const {
        url
      } =
        req.body || {};

      if (
        !isHttpUrl(url)
      ) {

        res.status(400).json({
          message:
            "URL tidak valid."
        });

        return;

      }

      const parsed =
        new URL(url);

      /*
        Hanya izinkan host Vid3y
        yang dimaksud aplikasi.
      */

      if (
        !isAllowedVid3yHost(
          parsed.hostname
        )
      ) {

        res.status(403).json({
          message:
            "Host URL tidak diizinkan."
        });

        return;

      }

      /*
        Jangan mengikuti redirect.
        Ini mengurangi risiko SSRF.
      */

      const response =
        await fetch(
          url,
          {
            method:
              "GET",

            redirect:
              "error",

            signal:
              AbortSignal.timeout(
                30_000
              )
          }
        );

      if (!response.ok) {

        res.status(502).json({
          message:
            `Server sumber mengembalikan HTTP ${response.status}.`
        });

        return;

      }

      const contentType =
        String(
          response.headers.get(
            "content-type"
          ) || ""
        )
          .toLowerCase()
          .split(";")[0];

      /*
        Jika URL hanya mengembalikan HTML,
        backend tidak berpura-pura berhasil.

        Ini penting karena banyak situs downloader
        hanya mengirim halaman/player HTML dan
        membutuhkan endpoint API resmi atau
        final media URL.
      */

      if (
        !isSupportedMediaType(
          contentType
        )
      ) {

        res.status(422).json({
          message:
            "URL tersebut tidak langsung mengembalikan file media. Backend membutuhkan final media URL atau API resmi dari layanan tersebut."
        });

        return;

      }

      const contentLength =
        Number(
          response.headers.get(
            "content-length"
          ) || 0
        );

      if (
        contentLength >
        MAX_FILE_SIZE
      ) {

        res.status(413).json({
          message:
            "Media melebihi batas ukuran BRANKAS."
        });

        return;

      }

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      if (
        buffer.length >
        MAX_FILE_SIZE
      ) {

        res.status(413).json({
          message:
            "Media melebihi batas ukuran BRANKAS."
        });

        return;

      }

      const id =
        crypto.randomUUID();

      const extension =
        extensionFromMime(
          contentType
        );

      const originalName =
        `vid3y-${id}${extension}`;

      const objectKey =
        createObjectKey(
          id,
          originalName
        );

      await s3.send(
        new PutObjectCommand({
          Bucket:
            R2_BUCKET,

          Key:
            objectKey,

          Body:
            buffer,

          ContentType:
            contentType,

          ContentLength:
            buffer.length
        })
      );

      await pool.query(
        `
          INSERT INTO files
          (
            id,
            original_name,
            object_key,
            mime_type,
            size,
            source
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            'vid3y'
          )
        `,
        [
          id,
          originalName,
          objectKey,
          contentType,
          buffer.length
        ]
      );

      res.status(201).json({
        message:
          "Media berhasil disimpan ke BRANKAS."
      });

    } catch (error) {

      console.error(
        "Vid3y import error:",
        error
      );

      res.status(502).json({
        message:
          "Media Vid3y tidak dapat diambil. Pastikan URL tersebut merupakan URL media yang dapat diakses langsung."
      });

    }

  }
);


/* ============================================================
   TIKTOK IMPORT
   ============================================================ */

app.post(
  "/api/import/tiktok",
  requireAuth,
  rateLimit({
    windowMs:
      60_000,

    max:
      5
  }),
  async (
    req,
    res
  ) => {

    try {

      const {
        url
      } =
        req.body || {};

      if (
        !isTikTokUrl(url)
      ) {

        res.status(400).json({
          message:
            "URL TikTok tidak valid."
        });

        return;

      }

      /*
        Secara default kita tidak melakukan
        scraping TikTok secara diam-diam.

        Jika administrator mengaktifkan yt-dlp
        pada server, proses dapat dilakukan
        melalui adapter di bawah.
      */

      if (
        !ALLOW_YTDLP
      ) {

        res.status(501).json({
          message:
            "TikTok importer belum diaktifkan di backend. Aktifkan ALLOW_YTDLP=1 pada server jika ingin menggunakan adapter yt-dlp."
        });

        return;

      }

      const result =
        await downloadTikTokWithYtdlp(
          url
        );

      if (
        !result?.buffer ||
        !result.buffer.length
      ) {

        res.status(502).json({
          message:
            "yt-dlp tidak menghasilkan media."
        });

        return;

      }

      if (
        result.buffer.length >
        MAX_FILE_SIZE
      ) {

        res.status(413).json({
          message:
            "Media TikTok melebihi batas ukuran BRANKAS."
        });

        return;

      }

      const id =
        crypto.randomUUID();

      const mime =
        result.mimeType ||
        "video/mp4";

      const extension =
        extensionFromMime(
          mime
        );

      const originalName =
        `tiktok-${id}${extension}`;

      const objectKey =
        createObjectKey(
          id,
          originalName
        );

      await s3.send(
        new PutObjectCommand({
          Bucket:
            R2_BUCKET,

          Key:
            objectKey,

          Body:
            result.buffer,

          ContentType:
            mime,

          ContentLength:
            result.buffer.length
        })
      );

      await pool.query(
        `
          INSERT INTO files
          (
            id,
            original_name,
            object_key,
            mime_type,
            size,
            source
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            'tiktok'
          )
        `,
        [
          id,
          originalName,
          objectKey,
          mime,
          result.buffer.length
        ]
      );

      res.status(201).json({
        message:
          "Video TikTok berhasil disimpan ke BRANKAS."
      });

    } catch (error) {

      console.error(
        "TikTok import error:",
        error
      );

      res.status(502).json({
        message:
          "TikTok tidak dapat diproses oleh importer."
      });

    }

  }
);


/* ============================================================
   HEALTH CHECK
   ============================================================ */

app.get(
  "/health",
  async (
    req,
    res
  ) => {

    try {

      await pool.query(
        "SELECT 1"
      );

      res.json({
        status:
          "ok"
      });

    } catch {

      res.status(503).json({
        status:
          "database_unavailable"
      });

    }

  }
);


/* ============================================================
   404
   ============================================================ */

app.use(
  (
    req,
    res
  ) => {

    res.status(404).json({
      message:
        "Endpoint tidak ditemukan."
    });

  }
);


/* ============================================================
   ERROR HANDLER
   ============================================================ */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Unhandled error:",
      error
    );

    if (
      res.headersSent
    ) {

      next(error);

      return;

    }

    res.status(500).json({
      message:
        "Terjadi kesalahan server."
    });

  }
);


/* ============================================================
   HELPER — FILE LOOKUP
   ============================================================ */

async function getFileById(
  id
) {

  if (
    !isUuid(id)
  ) {

    return null;

  }

  const result =
    await pool.query(
      `
        SELECT
          id,
          original_name,
          object_key,
          mime_type,
          size,
          source,
          created_at
        FROM files
        WHERE id = $1
        LIMIT 1
      `,
      [
        id
      ]
    );

  return (
    result.rows[0] ||
    null
  );

}


/* ============================================================
   HELPER — UUID
   ============================================================ */

function isUuid(
  value
) {

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );

}


/* ============================================================
   HELPER — FILENAME
   ============================================================ */

function sanitizeFilename(
  filename
) {

  const cleaned =
    String(
      filename ||
      "file"
    )
      .replace(
        /[\u0000-\u001f\u007f]/g,
        ""
      )
      .replace(
        /[/\\]/g,
        "_"
      )
      .replace(
        /[<>:"|?*]/g,
        "_"
      )
      .trim();

  if (!cleaned) {
    return "file";
  }

  return cleaned.slice(
    0,
    240
  );

}


function safeMetadataValue(
  value
) {

  return String(
    value || ""
  )
    .replace(
      /[\r\n]/g,
      " "
    )
    .slice(
      0,
      240
    );

}


/* ============================================================
   HELPER — OBJECT KEY
   ============================================================ */

function createObjectKey(
  id,
  filename
) {

  const safe =
    sanitizeFilename(
      filename
    );

  return `vault/${id}/${safe}`;

}


/* ============================================================
   HELPER — CONTENT DISPOSITION
   ============================================================ */

function contentDisposition(
  filename
) {

  const safe =
    sanitizeFilename(
      filename
    );

  const fallback =
    safe.replace(
      /[^\x20-\x7E]/g,
      "_"
    );

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
    safe
  )}`;

}


/* ============================================================
   HELPER — ORIGIN
   ============================================================ */

function isAllowedOrigin(
  origin
) {

  if (
    FRONTEND_ORIGIN === "*"
  ) {

    return true;

  }

  const allowed =
    FRONTEND_ORIGIN
      .split(",")
      .map(
        (item) =>
          item.trim()
      )
      .filter(Boolean);

  return allowed.includes(
    origin
  );

}


/* ============================================================
   HELPER — HTTP URL
   ============================================================ */

function isHttpUrl(
  value
) {

  try {

    const url =
      new URL(
        String(value || "")
      );

    return (
      url.protocol ===
        "http:" ||
      url.protocol ===
        "https:"
    );

  } catch {

    return false;

  }

}


/* ============================================================
   HELPER — TIKTOK URL
   ============================================================ */

function isTikTokUrl(
  value
) {

  try {

    const url =
      new URL(
        String(value || "")
      );

    const hostname =
      url.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    return (
      hostname ===
        "tiktok.com" ||
      hostname.endsWith(
        ".tiktok.com"
      )
    );

  } catch {

    return false;

  }

}


/* ============================================================
   HELPER — VID3Y HOST
   ============================================================ */

function isAllowedVid3yHost(
  hostname
) {

  const host =
    String(
      hostname || ""
    )
      .toLowerCase()
      .replace(
        /^www\./,
        ""
      );

  return (
    host ===
      "vid3y.my.id" ||
    host.endsWith(
      ".vid3y.my.id"
    )
  );

}


/* ============================================================
   HELPER — MEDIA MIME
   ============================================================ */

function isSupportedMediaType(
  mime
) {

  const value =
    String(
      mime || ""
    ).toLowerCase();

  return (
    value.startsWith(
      "video/"
    ) ||
    value.startsWith(
      "audio/"
    ) ||
    value.startsWith(
      "image/"
    )
  );

}


/* ============================================================
   HELPER — MIME EXTENSION
   ============================================================ */

function extensionFromMime(
  mime
) {

  const map = {
    "video/mp4":
      ".mp4",

    "video/webm":
      ".webm",

    "video/quicktime":
      ".mov",

    "video/x-matroska":
      ".mkv",

    "audio/mpeg":
      ".mp3",

    "audio/mp4":
      ".m4a",

    "audio/wav":
      ".wav",

    "audio/ogg":
      ".ogg",

    "image/jpeg":
      ".jpg",

    "image/png":
      ".png",

    "image/webp":
      ".webp",

    "image/gif":
      ".gif"
  };

  return (
    map[
      String(
        mime || ""
      ).toLowerCase()
    ] ||
    ".bin"
  );

}


/* ============================================================
   HELPER — RANGE
   ============================================================ */

function parseRange(
  header,
  size
) {

  const match =
    String(header || "")
      .match(
        /^bytes=(\d*)-(\d*)$/i
      );

  if (!match) {
    return null;
  }

  let start =
    match[1]
      ? Number(match[1])
      : null;

  let end =
    match[2]
      ? Number(match[2])
      : null;

  if (
    start === null &&
    end === null
  ) {

    return null;

  }

  if (
    start === null
  ) {

    const suffix =
      end;

    if (
      suffix <= 0
    ) {

      return null;

    }

    start =
      Math.max(
        size - suffix,
        0
      );

    end =
      size - 1;

  } else {

    if (
      start >= size
    ) {

      return null;

    }

    if (
      end === null ||
      end >= size
    ) {

      end =
        size - 1;

    }

  }

  if (
    start > end
  ) {

    return null;

  }

  return {
    start,
    end
  };

}


/* ============================================================
   HELPER — REDEEM CODE COMPARISON
   ============================================================ */

function safeEqual(
  a,
  b
) {

  const first =
    Buffer.from(
      String(a || "")
    );

  const second =
    Buffer.from(
      String(b || "")
    );

  if (
    first.length !==
    second.length
  ) {

    return false;

  }

  return crypto.timingSafeEqual(
    first,
    second
  );

}


/* ============================================================
   HELPER — CLIENT KEY
   ============================================================ */

function getClientKey(
  req
) {

  const forwarded =
    String(
      req.headers[
        "x-forwarded-for"
      ] || ""
    )
      .split(",")[0]
      .trim();

  return (
    forwarded ||
    req.socket.remoteAddress ||
    "unknown"
  );

}


/* ============================================================
   HELPER — MULTIPART
   ============================================================ */

function extractBoundary(
  contentType
) {

  const match =
    String(
      contentType || ""
    ).match(
      /boundary="?([^";]+)"?/i
    );

  return match
    ? match[1]
    : null;

}


/*
  Multipart parser sederhana untuk satu file.

  Catatan:
  Untuk file sangat besar, production sebaiknya memakai
  presigned multipart upload langsung ke R2 agar server
  tidak menahan seluruh file dalam RAM.
*/

async function parseSingleMultipartFile(
  req,
  boundary,
  maxSize
) {

  const chunks = [];

  let total =
    0;

  for await (
    const chunk of req
  ) {

    total +=
      chunk.length;

    if (
      total >
      maxSize
    ) {

      throw new Error(
        "UPLOAD_TOO_LARGE"
      );

    }

    chunks.push(
      Buffer.from(chunk)
    );

  }

  const body =
    Buffer.concat(
      chunks
    );

  const boundaryBuffer =
    Buffer.from(
      `--${boundary}`
    );

  const start =
    body.indexOf(
      boundaryBuffer
    );

  if (
    start === -1
  ) {

    return null;

  }

  const headerStart =
    start +
    boundaryBuffer.length +
    2;

  const headerEnd =
    body.indexOf(
      Buffer.from(
        "\r\n\r\n"
      ),
      headerStart
    );

  if (
    headerEnd === -1
  ) {

    return null;

  }

  const headerText =
    body
      .subarray(
        headerStart,
        headerEnd
      )
      .toString(
        "utf8"
      );

  const disposition =
    headerText.match(
      /Content-Disposition:[^\r\n]*name="([^"]+)"[^\r\n]*filename="([^"]*)"/i
    );

  if (
    !disposition
  ) {

    return null;

  }

  const filename =
    sanitizeFilename(
      disposition[2]
    );

  const contentTypeMatch =
    headerText.match(
      /Content-Type:\s*([^\r\n]+)/i
    );

  const contentType =
    contentTypeMatch
      ? contentTypeMatch[1].trim()
      : "application/octet-stream";

  const dataStart =
    headerEnd + 4;

  const nextBoundary =
    body.indexOf(
      Buffer.from(
        `\r\n--${boundary}`
      ),
      dataStart
    );

  const dataEnd =
    nextBoundary === -1
      ? body.length
      : nextBoundary;

  const data =
    body.subarray(
      dataStart,
      dataEnd
    );

  if (
    data.length >
    maxSize
  ) {

    throw new Error(
      "UPLOAD_TOO_LARGE"
    );

  }

  return {
    filename,
    contentType,
    data
  };

}


/* ============================================================
   TIKTOK / YT-DLP
   ============================================================ */

const execFileAsync =
  promisify(
    execFile
  );


async function downloadTikTokWithYtdlp(
  url
) {

  /*
    yt-dlp biasanya menulis hasil ke stdout
    jika menggunakan output -.

    Kita meminta format video/audio yang kompatibel
    dan tidak menggunakan shell.
  */

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--no-progress",
    "-f",
    "bv*+ba/b",
    "-o",
    "-"
  ];

  args.push(
    url
  );

  const result =
    await execFileAsync(
      "yt-dlp",
      args,
      {
        maxBuffer:
          MAX_FILE_SIZE,

        timeout:
          120_000
      }
    );

  const buffer =
    Buffer.isBuffer(
      result.stdout
    )
      ? result.stdout
      : Buffer.from(
          result.stdout || ""
        );

  return {
    buffer,
    mimeType:
      "video/mp4"
  };

}


/* ============================================================
   SESSION CLEANUP
   ============================================================ */

setInterval(
  async () => {

    try {

      await pool.query(
        `
          DELETE FROM sessions
          WHERE expires_at < NOW()
        `
      );

    } catch (error) {

      console.error(
        "Session cleanup error:",
        error
      );

    }

  },
  5 * 60 * 1000
).unref();


/* ============================================================
   START SERVER
   ============================================================ */

async function start() {

  await initializeDatabase();

  app.listen(
    PORT,
    "0.0.0.0",
    () => {

      console.log(
        `BRANKAS backend running on port ${PORT}`
      );

    }
  );

}


start().catch(
  (error) => {

    console.error(
      "Failed to start BRANKAS:",
      error
    );

    process.exit(1);

  }
);
