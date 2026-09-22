"use strict";

/*
============================================================
BRANKAS FRONTEND
============================================================

File:
app.js

Frontend:
GitHub Pages

Backend:
Node.js / Express

API:
window.BRANKAS_CONFIG.API_BASE

Jika API_BASE kosong, frontend akan menggunakan
origin yang sama.
*/

const CONFIG = {
  API_BASE:
    window.BRANKAS_CONFIG?.API_BASE || "",

  MAX_FILE_SIZE:
    5 * 1024 * 1024 * 1024,

  SESSION_KEY:
    "brankas_session",

  SESSION_EXPIRY_KEY:
    "brankas_session_expiry"
};


/* ============================================================
   STATE
   ============================================================ */

const state = {
  token:
    sessionStorage.getItem(
      CONFIG.SESSION_KEY
    ) || "",

  sessionExpiry:
    Number(
      sessionStorage.getItem(
        CONFIG.SESSION_EXPIRY_KEY
      ) || 0
    ),

  files: [],

  activePage:
    "vault",

  activeSource:
    "vid3y",

  viewerFile:
    null,

  busy:
    false
};


/* ============================================================
   DOM
   ============================================================ */

const $ = (
  selector
) =>
  document.querySelector(
    selector
  );

const $$ = (
  selector
) =>
  Array.from(
    document.querySelectorAll(
      selector
    )
  );


/* ============================================================
   ELEMENTS
   ============================================================ */

const authScreen =
  $("#authScreen");

const appScreen =
  $("#appScreen");

const setupForm =
  $("#setupForm");

const loginForm =
  $("#loginForm");

const setupPassword =
  $("#setupPassword");

const setupPasswordConfirm =
  $("#setupPasswordConfirm");

const setupRedeem =
  $("#setupRedeem");

const loginPassword =
  $("#loginPassword");

const authTitle =
  $("#authTitle");

const authSubtitle =
  $("#authSubtitle");

const setupBox =
  $("#setupBox");

const loginBox =
  $("#loginBox");

const vaultPage =
  $("#vaultPage");

const downloaderPage =
  $("#downloaderPage");

const fileInput =
  $("#fileInput");

const fileGrid =
  $("#fileGrid");

const fileCount =
  $("#fileCount");

const uploadProgress =
  $("#uploadProgress");

const uploadProgressBar =
  $("#uploadProgressBar");

const uploadStatus =
  $("#uploadStatus");

const emptyState =
  $("#emptyState");

const viewerModal =
  $("#viewerModal");

const viewerContent =
  $("#viewerContent");

const viewerTitle =
  $("#viewerTitle");

const toastContainer =
  $("#toastContainer");

const statusText =
  $("#statusText");

const logoutButton =
  $("#logoutButton");


/* ============================================================
   INIT
   ============================================================ */

document.addEventListener(
  "DOMContentLoaded",
  initialize
);


async function initialize() {

  bindEvents();

  updateStatus();

  if (
    hasValidSession()
  ) {

    showApp();

    await loadFiles();

    return;

  }

  clearSession();

  await checkServerStatus();

}


/* ============================================================
   EVENT BINDINGS
   ============================================================ */

function bindEvents() {

  setupForm?.addEventListener(
    "submit",
    handleSetup
  );

  loginForm?.addEventListener(
    "submit",
    handleLogin
  );

  logoutButton?.addEventListener(
    "click",
    logout
  );

  fileInput?.addEventListener(
    "change",
    handleFileUpload
  );

  $("#refreshFiles")?.addEventListener(
    "click",
    () =>
      loadFiles()
  );

  $("#navVault")?.addEventListener(
    "click",
    () =>
      switchPage(
        "vault"
      )
  );

  $("#navDownloader")?.addEventListener(
    "click",
    () =>
      switchPage(
        "downloader"
      )
  );

  $("#vid3yTab")?.addEventListener(
    "click",
    () =>
      switchDownloader(
        "vid3y"
      )
  );

  $("#tiktokTab")?.addEventListener(
    "click",
    () =>
      switchDownloader(
        "tiktok"
      )
  );

  $("#vid3yForm")?.addEventListener(
    "submit",
    handleVid3y
  );

  $("#tiktokForm")?.addEventListener(
    "submit",
    handleTikTok
  );

  $("#closeViewer")?.addEventListener(
    "click",
    closeViewer
  );

  viewerModal?.addEventListener(
    "click",
    (event) => {

      if (
        event.target ===
        viewerModal
      ) {

        closeViewer();

      }

    }
  );

}


/* ============================================================
   SERVER STATUS
   ============================================================ */

async function checkServerStatus() {

  try {

    const data =
      await apiRequest(
        "/api/status",
        {
          method:
            "GET",

          auth:
            false
        }
      );

    if (
      data.initialized
    ) {

      showLogin();

    } else {

      showSetup();

    }

  } catch (error) {

    showAuthError(
      "Backend belum terhubung. Nanti kita hubungkan setelah server selesai dibuat."
    );

  }

}


/* ============================================================
   SETUP
   ============================================================ */

async function handleSetup(
  event
) {

  event.preventDefault();

  const password =
    setupPassword?.value || "";

  const confirm =
    setupPasswordConfirm?.value ||
    "";

  const redeem =
    setupRedeem?.value || "";

  if (
    password.length < 12
  ) {

    showToast(
      "Password minimal 12 karakter.",
      "error"
    );

    return;

  }

  if (
    password !== confirm
  ) {

    showToast(
      "Konfirmasi password tidak sama.",
      "error"
    );

    return;

  }

  if (
    redeem.length < 8
  ) {

    showToast(
      "Redeem code tidak valid.",
      "error"
    );

    return;

  }

  setBusy(
    true,
    setupForm
  );

  try {

    await apiRequest(
      "/api/setup",
      {
        method:
          "POST",

        auth:
          false,

        body: {
          password,
          redeem
        }
      }
    );

    showToast(
      "BRANKAS berhasil dibuat.",
      "success"
    );

    setupForm.reset();

    showLogin();

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

  } finally {

    setBusy(
      false,
      setupForm
    );

  }

}


/* ============================================================
   LOGIN
   ============================================================ */

async function handleLogin(
  event
) {

  event.preventDefault();

  const password =
    loginPassword?.value || "";

  if (
    !password
  ) {

    showToast(
      "Masukkan password.",
      "error"
    );

    return;

  }

  setBusy(
    true,
    loginForm
  );

  try {

    const data =
      await apiRequest(
        "/api/login",
        {
          method:
            "POST",

          auth:
            false,

          body: {
            password
          }
        }
      );

    saveSession(
      data.token,
      data.expiresAt
    );

    loginForm.reset();

    showToast(
      "Login berhasil.",
      "success"
    );

    showApp();

    await loadFiles();

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

  } finally {

    setBusy(
      false,
      loginForm
    );

  }

}


/* ============================================================
   SESSION
   ============================================================ */

function saveSession(
  token,
  expiresAt
) {

  state.token =
    String(
      token || ""
    );

  state.sessionExpiry =
    Number(
      expiresAt || 0
    );

  sessionStorage.setItem(
    CONFIG.SESSION_KEY,
    state.token
  );

  sessionStorage.setItem(
    CONFIG.SESSION_EXPIRY_KEY,
    String(
      state.sessionExpiry
    )
  );

  updateStatus();

}


function clearSession() {

  state.token =
    "";

  state.sessionExpiry =
    0;

  sessionStorage.removeItem(
    CONFIG.SESSION_KEY
  );

  sessionStorage.removeItem(
    CONFIG.SESSION_EXPIRY_KEY
  );

  updateStatus();

}


function hasValidSession() {

  if (
    !state.token
  ) {

    return false;

  }

  if (
    !state.sessionExpiry
  ) {

    return false;

  }

  return (
    Date.now() <
    state.sessionExpiry
  );

}


/* ============================================================
   LOGOUT
   ============================================================ */

function logout() {

  clearSession();

  state.files =
    [];

  showAuth();

  showToast(
    "Kamu telah logout.",
    "success"
  );

}


/* ============================================================
   PAGE SWITCHING
   ============================================================ */

function switchPage(
  page
) {

  state.activePage =
    page;

  const vault =
    page === "vault";

  vaultPage?.classList.toggle(
    "active",
    vault
  );

  downloaderPage?.classList.toggle(
    "active",
    !vault
  );

  $("#navVault")?.classList.toggle(
    "active",
    vault
  );

  $("#navDownloader")?.classList.toggle(
    "active",
    !vault
  );

}


/* ============================================================
   DOWNLOADER SOURCE
   ============================================================ */

function switchDownloader(
  source
) {

  state.activeSource =
    source;

  const vid3y =
    source === "vid3y";

  $("#vid3yTab")?.classList.toggle(
    "active",
    vid3y
  );

  $("#tiktokTab")?.classList.toggle(
    "active",
    !vid3y
  );

  $("#vid3yPanel")?.classList.toggle(
    "active",
    vid3y
  );

  $("#tiktokPanel")?.classList.toggle(
    "active",
    !vid3y
  );

}


/* ============================================================
   LOAD FILES
   ============================================================ */

async function loadFiles() {

  if (
    !hasValidSession()
  ) {

    showAuth();

    return;

  }

  try {

    const data =
      await apiRequest(
        "/api/files",
        {
          method:
            "GET"
        }
      );

    state.files =
      Array.isArray(
        data.files
      )
        ? data.files
        : [];

    renderFiles();

  } catch (error) {

    if (
      error.status === 401
    ) {

      clearSession();

      showAuth();

      return;

    }

    showToast(
      error.message,
      "error"
    );

  }

}


/* ============================================================
   RENDER FILES
   ============================================================ */

function renderFiles() {

  if (!fileGrid) {
    return;
  }

  fileGrid.innerHTML =
    "";

  if (fileCount) {

    fileCount.textContent =
      `${state.files.length} file`;

  }

  if (
    state.files.length === 0
  ) {

    emptyState?.classList.remove(
      "hidden"
    );

    return;

  }

  emptyState?.classList.add(
    "hidden"
  );

  for (
    const file of state.files
  ) {

    fileGrid.appendChild(
      createFileCard(
        file
      )
    );

  }

}


/* ============================================================
   FILE CARD
   ============================================================ */

function createFileCard(
  file
) {

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "file-card";

  const media =
    createFilePreview(
      file
    );

  const body =
    document.createElement(
      "div"
    );

  body.className =
    "file-card-body";

  const title =
    document.createElement(
      "h3"
    );

  title.textContent =
    file.name ||
    "Unnamed file";

  const meta =
    document.createElement(
      "p"
    );

  meta.textContent =
    `${formatBytes(file.size)} • ${formatDate(file.createdAt)}`;

  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "file-actions";

  const openButton =
    document.createElement(
      "button"
    );

  openButton.type =
    "button";

  openButton.className =
    "btn btn-primary";

  openButton.textContent =
    "Buka";

  openButton.addEventListener(
    "click",
    () =>
      openViewer(file)
  );

  const downloadButton =
    document.createElement(
      "button"
    );

  downloadButton.type =
    "button";

  downloadButton.className =
    "btn btn-secondary";

  downloadButton.textContent =
    "Download";

  downloadButton.addEventListener(
    "click",
    () =>
      downloadFile(file)
  );

  const deleteButton =
    document.createElement(
      "button"
    );

  deleteButton.type =
    "button";

  deleteButton.className =
    "btn btn-danger";

  deleteButton.textContent =
    "Hapus";

  deleteButton.addEventListener(
    "click",
    () =>
      deleteFile(file)
  );

  actions.append(
    openButton,
    downloadButton,
    deleteButton
  );

  body.append(
    title,
    meta,
    actions
  );

  card.append(
    media,
    body
  );

  return card;

}


/* ============================================================
   PREVIEW THUMBNAIL
   ============================================================ */

function createFilePreview(
  file
) {

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.className =
    "file-preview";

  const url =
    getPreviewUrl(
      file.id
    );

  const mime =
    String(
      file.mimeType || ""
    )
      .toLowerCase();

  if (
    mime.startsWith(
      "image/"
    )
  ) {

    const image =
      document.createElement(
        "img"
      );

    image.src =
      url;

    image.alt =
      file.name || "Image";

    image.loading =
      "lazy";

    wrapper.appendChild(
      image
    );

    return wrapper;

  }

  if (
    mime.startsWith(
      "video/"
    )
  ) {

    const video =
      document.createElement(
        "video"
      );

    video.src =
      url;

    video.preload =
      "metadata";

    video.muted =
      true;

    wrapper.appendChild(
      video
    );

    return wrapper;

  }

  const icon =
    document.createElement(
      "div"
    );

  icon.className =
    "file-type-icon";

  icon.textContent =
    getFileIcon(
      mime
    );

  wrapper.appendChild(
    icon
  );

  return wrapper;

}


/* ============================================================
   VIEWER
   ============================================================ */

function openViewer(
  file
) {

  state.viewerFile =
    file;

  if (viewerTitle) {

    viewerTitle.textContent =
      file.name ||
      "Preview";

  }

  if (!viewerContent) {
    return;
  }

  viewerContent.innerHTML =
    "";

  const url =
    getPreviewUrl(
      file.id
    );

  const mime =
    String(
      file.mimeType || ""
    )
      .toLowerCase();

  if (
    mime.startsWith(
      "video/"
    )
  ) {

    const video =
      document.createElement(
        "video"
      );

    video.controls =
      true;

    video.autoplay =
      false;

    video.playsInline =
      true;

    video.src =
      url;

    viewerContent.appendChild(
      video
    );

  } else if (
    mime.startsWith(
      "audio/"
    )
  ) {

    const audio =
      document.createElement(
        "audio"
      );

    audio.controls =
      true;

    audio.src =
      url;

    viewerContent.appendChild(
      audio
    );

  } else if (
    mime.startsWith(
      "image/"
    )
  ) {

    const image =
      document.createElement(
        "img"
      );

    image.src =
      url;

    image.alt =
      file.name || "Image";

    viewerContent.appendChild(
      image
    );

  } else if (
    mime ===
    "application/pdf"
  ) {

    const frame =
      document.createElement(
        "iframe"
      );

    frame.src =
      url;

    frame.title =
      file.name ||
      "PDF";

    viewerContent.appendChild(
      frame
    );

  } else {

    const message =
      document.createElement(
        "div"
      );

    message.className =
      "viewer-message";

    message.innerHTML =
      `
        <strong>Preview belum tersedia untuk tipe file ini.</strong>
        <p>Gunakan tombol Download untuk membuka file.</p>
      `;

    viewerContent.appendChild(
      message
    );

  }

  viewerModal?.classList.add(
    "open"
  );

}


function closeViewer() {

  viewerModal?.classList.remove(
    "open"
  );

  if (viewerContent) {

    viewerContent.innerHTML =
      "";

  }

  state.viewerFile =
    null;

}


/* ============================================================
   UPLOAD
   ============================================================ */

async function handleFileUpload(
  event
) {

  const file =
    event.target.files?.[0];

  event.target.value =
    "";

  if (!file) {
    return;
  }

  if (
    file.size >
    CONFIG.MAX_FILE_SIZE
  ) {

    showToast(
      "Ukuran file melebihi 5 GB.",
      "error"
    );

    return;

  }

  if (
    !hasValidSession()
  ) {

    showAuth();

    return;

  }

  setUploadProgress(
    0,
    "Menyiapkan upload..."
  );

  try {

    await uploadFile(
      file
    );

    setUploadProgress(
      100,
      "Upload selesai."
    );

    showToast(
      "File berhasil disimpan.",
      "success"
    );

    await loadFiles();

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

    setUploadProgress(
      0,
      ""
    );

  }

}


function uploadFile(
  file
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const xhr =
        new XMLHttpRequest();

      const url =
        apiUrl(
          "/api/files"
        );

      xhr.open(
        "POST",
        url,
        true
      );

      xhr.setRequestHeader(
        "Authorization",
        `Bearer ${state.token}`
      );

      xhr.upload.addEventListener(
        "progress",
        (event) => {

          if (
            !event.lengthComputable
          ) {

            return;

          }

          const percent =
            Math.round(
              (
                event.loaded /
                event.total
              ) *
              100
            );

          setUploadProgress(
            percent,
            `Mengupload ${percent}%`
          );

        }
      );

      xhr.addEventListener(
        "load",
        () => {

          if (
            xhr.status >= 200 &&
            xhr.status < 300
          ) {

            resolve(
              parseJson(
                xhr.responseText
              )
            );

            return;

          }

          if (
            xhr.status === 401
          ) {

            clearSession();

            showAuth();

          }

          reject(
            new Error(
              extractErrorMessage(
                xhr.responseText,
                `Upload gagal (${xhr.status}).`
              )
            )
          );

        }
      );

      xhr.addEventListener(
        "error",
        () => {

          reject(
            new Error(
              "Koneksi upload gagal."
            )
          );

        }
      );

      xhr.addEventListener(
        "abort",
        () => {

          reject(
            new Error(
              "Upload dibatalkan."
            )
          );

        }
      );

      const formData =
        new FormData();

      formData.append(
        "file",
        file,
        file.name
      );

      xhr.send(
        formData
      );

    }
  );

}


/* ============================================================
   DOWNLOAD
   ============================================================ */

async function downloadFile(
  file
) {

  if (
    !hasValidSession()
  ) {

    showAuth();

    return;

  }

  try {

    /*
      Backend tetap memeriksa Bearer token.

      Karena browser tidak dapat mengirim Authorization
      melalui window.location, kita meminta response
      sebagai blob lalu membuat link download.

      Catatan:
      Untuk file multi-GB, versi production berikutnya
      sebaiknya memakai short-lived signed URL agar
      browser tidak menampung seluruh file sebagai Blob.
    */

    showToast(
      "Menyiapkan download...",
      "success"
    );

    const response =
      await fetch(
        apiUrl(
          `/api/files/${encodeURIComponent(
            file.id
          )}/download`
        ),
        {
          method:
            "GET",

          headers: {
            Authorization:
              `Bearer ${state.token}`
          }
        }
      );

    if (
      response.status === 401
    ) {

      clearSession();

      showAuth();

      return;

    }

    if (
      !response.ok
    ) {

      const text =
        await response.text();

      throw new Error(
        extractErrorMessage(
          text,
          "Download gagal."
        )
      );

    }

    const blob =
      await response.blob();

    const objectUrl =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      objectUrl;

    anchor.download =
      file.name ||
      "download";

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          objectUrl
        ),
      60_000
    );

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

  }

}


/* ============================================================
   DELETE
   ============================================================ */

async function deleteFile(
  file
) {

  const confirmed =
    window.confirm(
      `Hapus "${file.name}" dari BRANKAS?`
    );

  if (
    !confirmed
  ) {

    return;

  }

  try {

    await apiRequest(
      `/api/files/${encodeURIComponent(
        file.id
      )}`,
      {
        method:
          "DELETE"
      }
    );

    showToast(
      "File berhasil dihapus.",
      "success"
    );

    await loadFiles();

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

  }

}


/* ============================================================
   VID3Y
   ============================================================ */

async function handleVid3y(
  event
) {

  event.preventDefault();

  const input =
    $("#vid3yUrl");

  const url =
    input?.value.trim() ||
    "";

  if (
    !isHttpUrl(url)
  ) {

    showToast(
      "Masukkan URL Vid3y yang valid.",
      "error"
    );

    return;

  }

  setBusy(
    true,
    event.currentTarget
  );

  try {

    await apiRequest(
      "/api/import/vid3y",
      {
        method:
          "POST",

        body: {
          url
        }
      }
    );

    input.value =
      "";

    showToast(
      "Media berhasil masuk ke BRANKAS.",
      "success"
    );

    await loadFiles();

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

  } finally {

    setBusy(
      false,
      event.currentTarget
    );

  }

}


/* ============================================================
   TIKTOK
   ============================================================ */

async function handleTikTok(
  event
) {

  event.preventDefault();

  const input =
    $("#tiktokUrl");

  const url =
    input?.value.trim() ||
    "";

  if (
    !isTikTokUrl(url)
  ) {

    showToast(
      "Masukkan URL TikTok yang valid.",
      "error"
    );

    return;

  }

  setBusy(
    true,
    event.currentTarget
  );

  try {

    await apiRequest(
      "/api/import/tiktok",
      {
        method:
          "POST",

        body: {
          url
        }
      }
    );

    input.value =
      "";

    showToast(
      "Video berhasil masuk ke BRANKAS.",
      "success"
    );

    await loadFiles();

  } catch (error) {

    showToast(
      error.message,
      "error"
    );

  } finally {

    setBusy(
      false,
      event.currentTarget
    );

  }

}


/* ============================================================
   GENERIC API
   ============================================================ */

async function apiRequest(
  path,
  options = {}
) {

  const {
    method =
      "GET",

    body,

    auth =
      true
  } =
    options;

  const headers = {
    Accept:
      "application/json"
  };

  if (
    body !== undefined
  ) {

    headers[
      "Content-Type"
    ] =
      "application/json";

  }

  if (
    auth &&
    state.token
  ) {

    headers.Authorization =
      `Bearer ${state.token}`;

  }

  const response =
    await fetch(
      apiUrl(path),
      {
        method,

        headers,

        body:
          body !== undefined
            ? JSON.stringify(
                body
              )
            : undefined
      }
    );

  const text =
    await response.text();

  const data =
    parseJson(
      text
    );

  if (
    !response.ok
  ) {

    const error =
      new Error(
        data?.message ||
        `Request gagal (${response.status}).`
      );

    error.status =
      response.status;

    throw error;

  }

  return data;

}


/* ============================================================
   API URL
   ============================================================ */

function apiUrl(
  path
) {

  const base =
    String(
      CONFIG.API_BASE || ""
    )
      .replace(
        /\/+$/,
        ""
      );

  const normalized =
    path.startsWith(
      "/"
    )
      ? path
      : `/${path}`;

  return `${base}${normalized}`;

}


/* ============================================================
   ERROR PARSING
   ============================================================ */

function parseJson(
  text
) {

  try {

    return JSON.parse(
      text || "{}"
    );

  } catch {

    return {};

  }

}


function extractErrorMessage(
  text,
  fallback
) {

  const data =
    parseJson(
      text
    );

  return (
    data?.message ||
    fallback
  );

}


/* ============================================================
   URL HELPERS
   ============================================================ */

function getPreviewUrl(
  id
) {

  return apiUrl(
    `/api/files/${encodeURIComponent(
      id
    )}`
  );

}


function isHttpUrl(
  value
) {

  try {

    const url =
      new URL(
        value
      );

    return (
      url.protocol ===
        "https:" ||
      url.protocol ===
        "http:"
    );

  } catch {

    return false;

  }

}


function isTikTokUrl(
  value
) {

  try {

    const url =
      new URL(
        value
      );

    const host =
      url.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    return (
      host ===
        "tiktok.com" ||
      host.endsWith(
        ".tiktok.com"
      )
    );

  } catch {

    return false;

  }

}


/* ============================================================
   UI AUTH
   ============================================================ */

function showAuth() {

  authScreen?.classList.remove(
    "hidden"
  );

  appScreen?.classList.add(
    "hidden"
  );

  showLogin();

}


function showSetup() {

  authScreen?.classList.remove(
    "hidden"
  );

  appScreen?.classList.add(
    "hidden"
  );

  setupBox?.classList.remove(
    "hidden"
  );

  loginBox?.classList.add(
    "hidden"
  );

  if (authTitle) {

    authTitle.textContent =
      "Buat BRANKAS";

  }

  if (authSubtitle) {

    authSubtitle.textContent =
      "Buat password utama dan masukkan redeem code.";

  }

}


function showLogin() {

  authScreen?.classList.remove(
    "hidden"
  );

  appScreen?.classList.add(
    "hidden"
  );

  setupBox?.classList.add(
    "hidden"
  );

  loginBox?.classList.remove(
    "hidden"
  );

  if (authTitle) {

    authTitle.textContent =
      "Buka BRANKAS";

  }

  if (authSubtitle) {

    authSubtitle.textContent =
      "Masukkan password untuk membuka vault.";

  }

}


function showApp() {

  authScreen?.classList.add(
    "hidden"
  );

  appScreen?.classList.remove(
    "hidden"
  );

  switchPage(
    state.activePage
  );

  updateStatus();

}


/* ============================================================
   AUTH ERROR
   ============================================================ */

function showAuthError(
  message
) {

  showLogin();

  showToast(
    message,
    "error"
  );

}


/* ============================================================
   STATUS
   ============================================================ */

function updateStatus() {

  if (!statusText) {
    return;
  }

  if (
    hasValidSession()
  ) {

    statusText.textContent =
      "Terhubung";

    statusText.dataset.status =
      "online";

  } else {

    statusText.textContent =
      "Terkunci";

    statusText.dataset.status =
      "offline";

  }

}


/* ============================================================
   BUSY
   ============================================================ */

function setBusy(
  busy,
  container
) {

  state.busy =
    busy;

  if (!container) {
    return;
  }

  const buttons =
    container.querySelectorAll(
      "button"
    );

  buttons.forEach(
    (button) => {

      button.disabled =
        busy;

    }
  );

}


/* ============================================================
   UPLOAD PROGRESS
   ============================================================ */

function setUploadProgress(
  percent,
  message
) {

  if (
    uploadProgress
  ) {

    uploadProgress.classList.toggle(
      "hidden",
      !message
    );

  }

  if (
    uploadProgressBar
  ) {

    uploadProgressBar.style.width =
      `${Math.max(
        0,
        Math.min(
          100,
          percent
        )
      )}%`;

  }

  if (
    uploadStatus
  ) {

    uploadStatus.textContent =
      message || "";

  }

}


/* ============================================================
   TOAST
   ============================================================ */

function showToast(
  message,
  type =
    "info"
) {

  if (!toastContainer) {

    window.alert(
      message
    );

    return;

  }

  const toast =
    document.createElement(
      "div"
    );

  toast.className =
    `toast toast-${type}`;

  toast.textContent =
    message;

  toastContainer.appendChild(
    toast
  );

  setTimeout(
    () => {

      toast.classList.add(
        "hide"
      );

      setTimeout(
        () =>
          toast.remove(),
        250
      );

    },
    3500
  );

}


/* ============================================================
   FORMATTERS
   ============================================================ */

function formatBytes(
  bytes
) {

  const value =
    Number(
      bytes || 0
    );

  if (
    value < 1024
  ) {

    return `${value} B`;

  }

  const units = [
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  let size =
    value / 1024;

  let index =
    0;

  while (
    size >= 1024 &&
    index <
      units.length - 1
  ) {

    size /=
      1024;

    index +=
      1;

  }

  return `${size.toFixed(
    size >= 100
      ? 0
      : 1
  )} ${units[index]}`;

}


function formatDate(
  value
) {

  try {

    return new Intl.DateTimeFormat(
      "id-ID",
      {
        dateStyle:
          "medium",

        timeStyle:
          "short"
      }
    ).format(
      new Date(
        value
      )
    );

  } catch {

    return "-";

  }

}


function getFileIcon(
  mime
) {

  if (
    mime ===
    "application/pdf"
  ) {

    return "PDF";

  }

  if (
    mime.includes(
      "zip"
    ) ||
    mime.includes(
      "rar"
    ) ||
    mime.includes(
      "7z"
    )
  ) {

    return "ZIP";

  }

  if (
    mime.startsWith(
      "audio/"
    )
  ) {

    return "AUDIO";

  }

  if (
    mime.startsWith(
      "text/"
    )
  )
  {

    return "TXT";

  }

  return "FILE";

}


/* ============================================================
   SESSION EXPIRATION WATCHER
   ============================================================ */

setInterval(
  () => {

    if (
      state.token &&
      !hasValidSession()
    ) {

      clearSession();

      showAuth();

      showToast(
        "Session telah berakhir. Silakan login kembali.",
        "error"
      );

    }

  },
  10_000
);


/* ============================================================
   EXPORT DEBUG INFO
   ============================================================ */

window.BRANKAS =
  {
    version:
      "3.0.0",

    apiBase:
      CONFIG.API_BASE
  };
