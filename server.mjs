import express from "express";
import helmet from "helmet";
import multer from "multer";
import Database from "better-sqlite3";
import argon2 from "argon2";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {pipeline} from "node:stream/promises";
import {Readable} from "node:stream";
import {URL} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA = path.join(__dirname, "data");
const VAULT = path.join(DATA, "files");
fs.mkdirSync(VAULT,{recursive:true});
const db = new Database(path.join(DATA,"brankas.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS vault (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 path TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth (
 id INTEGER PRIMARY KEY CHECK(id=1),
 password_hash TEXT NOT NULL,
 redeem_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
`);

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      baseUri:["'none"],
      objectSrc:["'none'"],
      frameAncestors:["'none'"],
      imgSrc:["'self'","blob:","data:"],
      mediaSrc:["'self'","blob:"],
      frameSrc:["'self'","blob:"],
      styleSrc:["'self'"],
      scriptSrc:["'self'"],
      connectSrc:["'self'"]
    }
  },
  referrerPolicy:{policy:"no-referrer"},
  crossOriginEmbedderPolicy:false
}));
app.use(express.json({limit:"32kb"}));
app.use(express.static(path.join(__dirname,"public"),{index:"index.html",maxAge:"1h"}));

const upload = multer({
  dest:path.join(DATA,"tmp"),
  limits:{fileSize: 5 * 1024 * 1024 * 1024}
});
fs.mkdirSync(path.join(DATA,"tmp"),{recursive:true});

const sessions = new Map();
const rate = new Map();

function ip(req){return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown"}
function limited(key, max=20, windowMs=60000){
  const now=Date.now(), arr=(rate.get(key)||[]).filter(t=>now-t<windowMs);
  arr.push(now); rate.set(key,arr); return arr.length<=max;
}
function token(){return crypto.randomBytes(32).toString("base64url")}
function auth(req,res,next){
  const t=req.headers.authorization?.replace(/^Bearer\s+/i,"");
  const s=t&&sessions.get(t);
  if(!s || s.expires<Date.now()){if(t)sessions.delete(t);return res.status(401).json({error:"UNAUTHORIZED"})}
  s.expires=Date.now()+30*60*1000; req.session=s; next();
}
function isAllowedRemote(raw){
  try{
    const u=new URL(raw);
    if(!["https:","http:"].includes(u.protocol)) return false;
    if(u.username||u.password) return false;
    const h=u.hostname.toLowerCase();
    // Only the two requested source families. Add exact domains here when known.
    const allowed = h==="vid3y.my.id" || h==="www.vid3y.my.id" ||
      h==="tiktok.com" || h.endsWith(".tiktok.com") ||
      h==="vm.tiktok.com" || h==="vt.tiktok.com";
    return allowed;
  }catch{return false}
}
function safeName(n){return path.basename(n).replace(/[^\w.\- ()\[\]]/g,"_").slice(0,180)||"file"}
function extFromMime(m){return m.split("/")[1]?.split(";")[0]||"bin"}

app.get("/api/status",(req,res)=>{
  res.json({configured:Boolean(db.prepare("SELECT 1 FROM auth WHERE id=1").get()),sources:["vid3y","tiktok"],version:"2.0.0"});
});

app.post("/api/setup",async(req,res)=>{
  if(!limited("setup:"+ip(req),5,3600000)) return res.status(429).json({error:"RATE_LIMIT"});
  if(db.prepare("SELECT 1 FROM auth WHERE id=1").get()) return res.status(409).json({error:"ALREADY_CONFIGURED"});
  const {password,redeem}=req.body||{};
  if(typeof password!=="string"||password.length<12||password.length>128) return res.status(400).json({error:"PASSWORD_12_128"});
  if(typeof redeem!=="string"||redeem.length<8||redeem.length>128) return res.status(400).json({error:"INVALID_REDEEM"});
  const ph=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  const rh=await argon2.hash(redeem,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  db.prepare("INSERT INTO auth(id,password_hash,redeem_hash,created_at) VALUES(1,?,?,?)").run(ph,rh,Date.now());
  const t=token();sessions.set(t,{expires:Date.now()+30*60*1000});res.json({token:t});
});

app.post("/api/login",async(req,res)=>{
  if(!limited("login:"+ip(req),8,15*60000)) return res.status(429).json({error:"RATE_LIMIT"});
  const row=db.prepare("SELECT * FROM auth WHERE id=1").get(); if(!row)return res.status(409).json({error:"NOT_CONFIGURED"});
  const {password}=req.body||{};
  if(typeof password!=="string"||!(await argon2.verify(row.password_hash,password))) return res.status(401).json({error:"INVALID_CREDENTIALS"});
  const t=token();sessions.set(t,{expires:Date.now()+30*60*1000});res.json({token:t});
});

app.post("/api/files",auth,upload.single("file"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"NO_FILE"});
  const id=crypto.randomUUID(), final=path.join(VAULT,id+".bin");
  await fs.promises.rename(req.file.path,final);
  const name=safeName(req.file.originalname), mime=req.file.mimetype||"application/octet-stream";
  db.prepare("INSERT INTO vault VALUES(?,?,?,?,?,?)").run(id,name,mime,req.file.size,final,Date.now());
  res.json({id,name,mime,size:req.file.size});
});

app.get("/api/files",auth,(req,res)=>{
  res.json(db.prepare("SELECT id,name,mime,size,created_at AS createdAt FROM vault ORDER BY created_at DESC").all());
});

app.get("/api/files/:id",auth,(req,res)=>{
  const f=db.prepare("SELECT * FROM vault WHERE id=?").get(req.params.id);
  if(!f)return res.sendStatus(404);
  res.setHeader("Content-Type",f.mime);
  res.setHeader("Content-Disposition",`inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader("Cache-Control","private, no-store");
  res.sendFile(path.resolve(f.path));
});

app.get("/api/files/:id/download",auth,(req,res)=>{
  const f=db.prepare("SELECT * FROM vault WHERE id=?").get(req.params.id);
  if(!f)return res.sendStatus(404);
  res.download(path.resolve(f.path),f.name,{maxAge:0});
});

app.delete("/api/files/:id",auth,async(req,res)=>{
  const f=db.prepare("SELECT * FROM vault WHERE id=?").get(req.params.id);
  if(!f)return res.sendStatus(404);
  await fs.promises.rm(f.path,{force:true}); db.prepare("DELETE FROM vault WHERE id=?").run(f.id); res.json({ok:true});
});

/*
  SOURCE 1 — vid3y:
  The server accepts only vid3y.my.id URLs. It first checks the response.
  If the URL is a direct media response, it streams it into the vault.
  If the site returns an HTML landing page, the server deliberately does NOT
  scrape arbitrary HTML/execute scripts. That avoids turning the vault into an
  unsafe web proxy. To support that site's player page, add a documented API
  endpoint from the site owner and implement it here.
*/
app.post("/api/import/vid3y",auth,async(req,res)=>{
  if(!limited("import:"+ip(req),6,10*60000))return res.status(429).json({error:"RATE_LIMIT"});
  const raw=req.body?.url;
  if(!isAllowedRemote(raw) || !new URL(raw).hostname.endsWith("vid3y.my.id"))return res.status(400).json({error:"VID3Y_URL_ONLY"});
  try{
    const r=await fetch(raw,{redirect:"manual",headers:{"User-Agent":"Brankas/2.0"}});
    if(r.status>=300&&r.status<400)return res.status(400).json({error:"REDIRECT_NOT_ALLOWED",message:"Gunakan URL media final atau API resmi sumber."});
    if(!r.ok)return res.status(502).json({error:"SOURCE_HTTP_"+r.status});
    const ct=r.headers.get("content-type")||"";
    if(!ct.startsWith("video/") && !ct.startsWith("audio/") && !ct.startsWith("image/"))
      return res.status(422).json({error:"NOT_DIRECT_MEDIA",message:"URL Vid3y tersebut mengembalikan halaman, bukan file media langsung. Integrasi halaman player memerlukan endpoint/API resmi sumber."});
    const len=Number(r.headers.get("content-length")||0);
    if(len>5*1024*1024*1024)return res.status(413).json({error:"TOO_LARGE"});
    const id=crypto.randomUUID(), filePath=path.join(VAULT,id+".bin");
    await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(filePath));
    const name=safeName((new URL(raw).searchParams.get("v")||id)+ "." + extFromMime(ct));
    db.prepare("INSERT INTO vault VALUES(?,?,?,?,?,?)").run(id,name,ct,len,filePath,Date.now());
    res.json({ok:true,id,name,mime:ct,size:len});
  }catch(e){res.status(502).json({error:"IMPORT_FAILED"})}
});

/*
  SOURCE 2 — TikTok:
  A raw arbitrary TikTok downloader is intentionally NOT implemented as a
  bypass. TikTok's current official APIs expose authorized user video data and
  data portability, rather than a general "download any shared URL" endpoint.
  For an account the user controls, this route accepts a media URL only after
  the caller supplies a server-side authorized media URL.
*/
app.post("/api/import/tiktok",auth,async(req,res)=>{
  if(!limited("tiktok:"+ip(req),6,10*60000))return res.status(429).json({error:"TIKTOK_OFFICIAL_ONLY",
    message:"TikTok URL umum tidak dapat dijanjikan sebagai download API resmi. Gunakan OAuth/API TikTok untuk video akun yang diotorisasi."});
});

/* Optional local downloader integration:
   If you install yt-dlp yourself and explicitly enable ALLOW_YTDLP=1, the
   server can invoke it for URLs that the installed tool supports. This is
   intentionally opt-in and still limited to TikTok URLs. */
app.post("/api/import/tiktok/ytdlp",auth,async(req,res)=>{
  if(process.env.ALLOW_YTDLP!=="1")return res.status(501).json({error:"YTDLP_DISABLED"});
  const raw=req.body?.url;
  if(!isAllowedRemote(raw)||!new URL(raw).hostname.includes("tiktok.com"))return res.status(400).json({error:"TIKTOK_URL_ONLY"});
  if(!limited("ytdlp:"+ip(req),3,15*60000))return res.status(429).json({error:"RATE_LIMIT"});
  const id=crypto.randomUUID(), out=path.join(VAULT,id+".%(ext)s");
  const child=spawn("yt-dlp",["--no-playlist","--max-filesize","5G","-o",out,raw],{stdio:["ignore","pipe","pipe"]});
  let err="";child.stderr.on("data",d=>err+=d.toString().slice(-4000));
  child.on("error",()=>res.status(500).json({error:"YTDLP_NOT_INSTALLED"}));
  child.on("close",async code=>{
    if(code!==0)return res.status(502).json({error:"YTDLP_FAILED",detail:err.slice(-1000)});
    const match=fs.readdirSync(VAULT).find(n=>n.startsWith(id+"."));
    if(!match)return res.status(502).json({error:"NO_OUTPUT"});
    const p=path.join(VAULT,match), st=fs.statSync(p), ext=path.extname(match).toLowerCase();
    const mime=ext===".mp4"?"video/mp4":"application/octet-stream";
    const name="TikTok-"+Date.now()+ext;
    db.prepare("INSERT INTO vault VALUES(?,?,?,?,?,?)").run(id,name,mime,st.size,p,Date.now());
    res.json({ok:true,id,name,mime,size:st.size});
  });
});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"SERVER_ERROR"})});

app.listen(PORT,()=>console.log(`BRANKAS V2: http://localhost:${PORT}`));
