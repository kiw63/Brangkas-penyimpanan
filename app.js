"use strict";

/*
  ============================================================
  BRANKAS — FRONTEND APPLICATION
  ============================================================

  Catatan:
  - Frontend ini sengaja tidak menyimpan password.
  - Token sesi hanya digunakan selama sesi aktif.
  - Backend URL bisa diatur melalui window.BRANKAS_CONFIG.
  - Jika config tidak tersedia, API dianggap berada di origin
    yang sama.
*/


/* ============================================================
   CONFIGURATION
   ============================================================ */

const CONFIG = {
  API_BASE:
    window.BRANKAS_CONFIG?.API_BASE ||
    "",

  SESSION_STORAGE_KEY:
    "brankas_session",

  SESSION_EXPIRES_KEY:
    "brankas_session_expires",

  MAX_FILE_SIZE:
    5 * 1024 * 1024 * 1024
};


/* ============================================================
   APPLICATION STATE
   ============================================================ */

const state = {
  token: null,
  sessionExpires: 0,

  files: [],

  activePage: "vault",

  activeSource: "vid3y",

  viewerFile: null,

  busy: false
};


/* ============================================================
   DOM HELPERS
   ============================================================ */

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  Array.from(document.querySelectorAll(selector));


/* ============================================================
   DOM REFERENCES
   ============================================================ */

const authScreen =
  $("#authScreen");

const setupPanel =
  $("#setupPanel");

const loginPanel =
  $("#loginPanel");

const setupForm =
  $("#setupForm");

const loginForm =
  $("#loginForm");

const authMessage =
  $("#authMessage");

const app =
  $("#app");

const connectionStatus =
  $("#connectionStatus");

const logoutButton =
  $("#logoutButton");

const navButtons =
  $$(".nav-button");

const pages =
  $$(".page");

const fileInput =
  $("#fileInput");

const fileInputEmpty =
  $("#fileInputEmpty");

const refreshFilesButton =
  $("#refreshFilesButton");

const fileGrid =
  $("#fileGrid");

const emptyState =
  $("#emptyState");

const fileCount =
  $("#fileCount");

const uploadArea =
  $("#uploadArea");

const uploadProgressBar =
  $("#uploadProgressBar");

const uploadProgressText =
  $("#uploadProgressText");

const uploadStatusText =
  $("#uploadStatusText");

const sourceTabs =
  $$(".source-tab");

const sourcePanels =
  $$(".source-panel");

const vid3yUrl =
  $("#vid3yUrl");

const tiktokUrl =
  $("#tiktokUrl");

const vid3yDownloadButton =
  $("#vid3yDownloadButton");

const tiktokDownloadButton =
  $("#tiktokDownloadButton");

const downloaderMessage =
  $("#downloaderMessage");

const viewerModal =
  $("#viewerModal");

const modalBackdrop =
  $("#modalBackdrop");

const closeViewerButton =
  $("#closeViewerButton");

const viewerTitle =
  $("#viewerTitle");

const viewerContent =
  $("#viewerContent");

const viewerDownloadButton =
  $("#viewerDownloadButton");

const toast =
  $("#toast");


/* ============================================================
   INITIALIZATION
   ============================================================ */

document.addEventListener(
  "DOMContentLoaded",
  initialize
);


async function initialize() {

  bindEvents();

  restoreSession();

  await checkServerStatus();

  if (state.token) {

    try {

      await loadFiles();

      showApp();

    } catch {

      clearSession();

      await determineAuthState();

    }

  } else {

    await determineAuthState();

  }
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
    handleLogout
  );

  refreshFilesButton?.addEventListener(
    "click",
    async () => {

      if (!state.token) {
        return;
      }

      await loadFiles();

    }
  );

  fileInput?.addEventListener(
    "change",
    handleFileSelection
  );

  fileInputEmpty?.addEventListener(
    "change",
    handleFileSelection
  );

  navButtons.forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          const page =
            button.dataset.page;

          switchPage(page);

        }
      );

    }
  );

  sourceTabs.forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          const source =
            button.dataset.source;

          switchDownloaderSource(source);

        }
      );

    }
  );

  vid3yDownloadButton?.addEventListener(
    "click",
    handleVid3yImport
  );

  tiktokDownloadButton?.addEventListener(
    "click",
    handleTikTokImport
  );

  closeViewerButton?.addEventListener(
    "click",
    closeViewer
  );

  modalBackdrop?.addEventListener(
    "click",
    closeViewer
  );

  viewerDownloadButton?.addEventListener(
    "click",
    handleViewerDownload
  );

  document.addEventListener(
    "keydown",
    handleKeyboard
  );

}


/* ============================================================
   AUTH STATE
   ============================================================ */

async function determineAuthState() {

  try {

    const result =
      await apiRequest(
        "/api/status",
        {
          method: "GET",
          auth: false
        }
      );

    if (result.initialized) {

      showLogin();

    } else {

      showSetup();

    }

  } catch (error) {

    showAuthMessage(
      error.message ||
      "Backend belum dapat dihubungi."
    );

    showLogin();

  }
}


function showSetup() {

  authScreen.classList.remove(
    "hidden"
  );

  app.classList.add(
    "hidden"
  );

  setupPanel.classList.remove(
    "hidden"
  );

  loginPanel.classList.add(
    "hidden"
  );

  clearAuthMessage();

}


function showLogin() {

  authScreen.classList.remove(
    "hidden"
  );

  app.classList.add(
    "hidden"
  );

  loginPanel.classList.remove(
    "hidden"
  );

  setupPanel.classList.add(
    "hidden"
  );

  clearAuthMessage();

}


function showApp() {

  authScreen.classList.add(
    "hidden"
  );

  app.classList.remove(
    "hidden"
  );

  switchPage(
    state.activePage || "vault"
  );

  updateConnectionStatus(
    true
  );

}


function showAuthMessage(
  message,
  success = false
) {

  if (!authMessage) {
    return;
  }

  authMessage.textContent =
    String(message || "");

  authMessage.classList.toggle(
    "success",
    success
  );

}


function clearAuthMessage() {

  if (!authMessage) {
    return;
  }

  authMessage.textContent = "";

  authMessage.classList.remove(
    "success"
  );

}


/* ============================================================
   SETUP
   ============================================================ */

async function handleSetup(
  event
) {

  event.preventDefault();

  const password =
    $("#setupPassword")?.value || "";

  const confirmPassword =
    $("#setupPasswordConfirm")?.value || "";

  const redeem =
    $("#redeemCode")?.value.trim() || "";

  clearAuthMessage();

  if (password.length < 12) {

    showAuthMessage(
      "Password harus minimal 12 karakter."
    );

    return;
  }

  if (password !== confirmPassword) {

    showAuthMessage(
      "Konfirmasi password tidak sama."
    );

    return;
  }

  if (redeem.length < 8) {

    showAuthMessage(
      "Redeem code tidak valid."
    );

    return;
  }

  setButtonBusy(
    setupForm.querySelector(
      'button[type="submit"]'
    ),
    true,
    "Membuat..."
  );

  try {

    await apiRequest(
      "/api/setup",
      {
        method: "POST",
        body: {
          password,
          redeem
        },
        auth: false
      }
    );

    showAuthMessage(
      "BRANKAS berhasil dibuat. Silakan masuk.",
      true
    );

    setupForm.reset();

    setTimeout(
      showLogin,
      700
    );

  } catch (error) {

    showAuthMessage(
      error.message
    );

  } finally {

    setButtonBusy(
      setupForm.querySelector(
        'button[type="submit"]'
      ),
      false
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
    $("#loginPassword")?.value || "";

  clearAuthMessage();

  if (!password) {

    showAuthMessage(
      "Masukkan password."
    );

    return;
  }

  const button =
    loginForm.querySelector(
      'button[type="submit"]'
    );

  setButtonBusy(
    button,
    true,
    "Membuka..."
  );

  try {

    const result =
      await apiRequest(
        "/api/login",
        {
          method: "POST",
          body: {
            password
          },
          auth: false
        }
      );

    if (!result.token) {

      throw new Error(
        "Server tidak memberikan session token."
      );

    }

    saveSession(
      result.token,
      result.expiresAt
    );

    loginForm.reset();

    await loadFiles();

    showApp();

    showToast(
      "BRANKAS berhasil dibuka."
    );

  } catch (error) {

    showAuthMessage(
      error.message
    );

  } finally {

    setButtonBusy(
      button,
      false
    );

  }

}


/* ============================================================
   LOGOUT
   ============================================================ */

function handleLogout() {

  const confirmed =
    window.confirm(
      "Keluar dari BRANKAS?"
    );

  if (!confirmed) {
    return;
  }

  clearSession();

  state.files = [];

  renderFiles();

  showLogin();

  showToast(
    "Session ditutup."
  );

}


/* ============================================================
   SESSION
   ============================================================ */

function saveSession(
  token,
  expiresAt
) {

  state.token =
    String(token);

  state.sessionExpires =
    Number(expiresAt) ||
    (Date.now() + 30 * 60 * 1000);

  sessionStorage.setItem(
    CONFIG.SESSION_STORAGE_KEY,
    state.token
  );

  sessionStorage.setItem(
    CONFIG.SESSION_EXPIRES_KEY,
    String(state.sessionExpires)
  );

}


function restoreSession() {

  const token =
    sessionStorage.getItem(
      CONFIG.SESSION_STORAGE_KEY
    );

  const expires =
    Number(
      sessionStorage.getItem(
        CONFIG.SESSION_EXPIRES_KEY
      )
    );

  if (
    !token ||
    !expires ||
    Date.now() >= expires
  ) {

    clearSession();

    return;
  }

  state.token =
    token;

  state.sessionExpires =
    expires;

}


function clearSession() {

  state.token = null;

  state.sessionExpires = 0;

  sessionStorage.removeItem(
    CONFIG.SESSION_STORAGE_KEY
  );

  sessionStorage.removeItem(
    CONFIG.SESSION_EXPIRES_KEY
  );

}


/* ============================================================
   SERVER STATUS
   ============================================================ */

async function checkServerStatus() {

  try {

    const result =
      await apiRequest(
        "/api/status",
        {
          method: "GET",
          auth: false
        }
      );

    updateConnectionStatus(
      true
    );

    return result;

  } catch {

    updateConnectionStatus(
      false
    );

    return null;

  }

}


function updateConnectionStatus(
  connected
) {

  if (!connectionStatus) {
    return;
  }

  if (connected) {

    connectionStatus.textContent =
      "TERHUBUNG";

    connectionStatus.style.color =
      "var(--success)";

  } else {

    connectionStatus.textContent =
      "OFFLINE";

    connectionStatus.style.color =
      "var(--danger)";

  }

}


/* ============================================================
   API REQUEST
   ============================================================ */

async function apiRequest(
  path,
  options = {}
) {

  const {
    method = "GET",
    body = undefined,
    auth = true,
    headers = {}
  } = options;

  const requestHeaders = {
    Accept:
      "application/json",

    ...headers
  };

  if (
    body !== undefined &&
    !(body instanceof FormData)
  ) {

    requestHeaders[
      "Content-Type"
    ] =
      "application/json";

  }

  if (
    auth &&
    state.token
  ) {

    requestHeaders.Authorization =
      `Bearer ${state.token}`;

  }

  const url =
    buildApiUrl(path);

  let response;

  try {

    response =
      await fetch(
        url,
        {
          method,
          headers: requestHeaders,
          body:
            body instanceof FormData
              ? body
              : body !== undefined
                ? JSON.stringify(body)
                : undefined,

          credentials: "omit",

          cache: "no-store"
        }
      );

  } catch {

    throw new Error(
      "Tidak dapat terhubung ke server BRANKAS."
    );

  }

  let data = null;

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    contentType.includes(
      "application/json"
    )
  ) {

    try {

      data =
        await response.json();

    } catch {

      data = null;

    }

  } else {

    try {

      const text =
        await response.text();

      data =
        text
          ? { message: text }
          : null;

    } catch {

      data = null;

    }

  }

  if (!response.ok) {

    if (
      response.status === 401 ||
      response.status === 403
    ) {

      clearSession();

    }

    throw new Error(
      data?.message ||
      `Request gagal (${response.status}).`
    );

  }

  return data || {};
}


/* ============================================================
   API URL
   ============================================================ */

function buildApiUrl(
  path
) {

  const base =
    String(
      CONFIG.API_BASE || ""
    ).replace(
      /\/+$/,
      ""
    );

  const cleanPath =
    String(path).startsWith("/")
      ? path
      : `/${path}`;

  return `${base}${cleanPath}`;

}


/* ============================================================
   LOAD FILES
   ============================================================ */

async function loadFiles() {

  if (!state.token) {
    return;
  }

  try {

    const result =
      await apiRequest(
        "/api/files",
        {
          method: "GET"
        }
      );

    state.files =
      Array.isArray(result.files)
        ? result.files
        : [];

    renderFiles();

    updateConnectionStatus(
      true
    );

  } catch (error) {

    if (!state.token) {

      showLogin();

      return;

    }

    showToast(
      error.message
    );

  }

}


/* ============================================================
   FILE RENDERING
   ============================================================ */

function renderFiles() {

  if (!fileGrid) {
    return;
  }

  fileGrid.innerHTML = "";

  const files =
    [...state.files].sort(
      (a, b) =>
        new Date(
          b.createdAt || 0
        ) -
        new Date(
          a.createdAt || 0
        )
    );

  fileCount.textContent =
    `${files.length} file${
      files.length === 1
        ? ""
        : "s"
    }`;

  if (!files.length) {

    emptyState.classList.remove(
      "hidden"
    );

    fileGrid.classList.add(
      "hidden"
    );

    return;
  }

  emptyState.classList.add(
    "hidden"
  );

  fileGrid.classList.remove(
    "hidden"
  );

  const fragment =
    document.createDocumentFragment();

  files.forEach(
    (file) => {

      fragment.appendChild(
        createFileCard(file)
      );

    }
  );

  fileGrid.appendChild(
    fragment
  );

}


/* ============================================================
   CREATE FILE CARD
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

  const preview =
    document.createElement(
      "div"
    );

  preview.className =
    "file-preview";

  const typeBadge =
    document.createElement(
      "span"
    );

  typeBadge.className =
    "file-type-badge";

  typeBadge.textContent =
    getFileTypeLabel(file);

  preview.appendChild(
    typeBadge
  );


  /* -------------------------
     IMAGE
     ------------------------- */

  if (
    isImageFile(file)
  ) {

    const img =
      document.createElement(
        "img"
      );

    img.loading =
      "lazy";

    img.alt =
      file.name || "Image";

    img.src =
      getPreviewUrl(file);

    img.addEventListener(
      "error",
      () => {

        preview.innerHTML =
          "";

        preview.appendChild(
          typeBadge
        );

        preview.appendChild(
          createFileIcon(
            getFileTypeLabel(file)
          )
        );

      }
    );

    preview.appendChild(
      img
    );

  }


  /* -------------------------
     VIDEO
     ------------------------- */

  else if (
    isVideoFile(file)
  ) {

    const video =
      document.createElement(
        "video"
      );

    video.muted =
      true;

    video.playsInline =
      true;

    video.preload =
      "metadata";

    video.src =
      getPreviewUrl(file);

    video.addEventListener(
      "error",
      () => {

        video.remove();

        preview.appendChild(
          createFileIcon(
            "VIDEO"
          )
        );

      }
    );

    preview.appendChild(
      video
    );

  }


  /* -------------------------
     AUDIO
     ------------------------- */

  else if (
    isAudioFile(file)
  ) {

    const audio =
      document.createElement(
        "audio"
      );

    audio.controls =
      true;

    audio.preload =
      "metadata";

    audio.src =
      getPreviewUrl(file);

    preview.appendChild(
      audio
    );

  }


  /* -------------------------
     OTHER
     ------------------------- */

  else {

    preview.appendChild(
      createFileIcon(
        getFileTypeLabel(file)
      )
    );

  }


  const details =
    document.createElement(
      "div"
    );

  details.className =
    "file-details";


  const name =
    document.createElement(
      "h3"
    );

  name.className =
    "file-name";

  name.title =
    file.name || "Unnamed file";

  name.textContent =
    file.name || "Unnamed file";


  const meta =
    document.createElement(
      "div"
    );

  meta.className =
    "file-meta";

  const size =
    document.createElement(
      "span"
    );

  size.textContent =
    formatBytes(
      Number(file.size) || 0
    );

  const date =
    document.createElement(
      "span"
    );

  date.textContent =
    formatDate(
      file.createdAt
    );

  meta.append(
    size,
    date
  );


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
    "file-action";

  openButton.textContent =
    "Buka";

  openButton.addEventListener(
    "click",
    () => openViewer(file)
  );


  const downloadButton =
    document.createElement(
      "button"
    );

  downloadButton.type =
    "button";

  downloadButton.className =
    "file-action";

  downloadButton.textContent =
    "Download";

  downloadButton.addEventListener(
    "click",
    () => downloadFile(file)
  );


  const deleteButton =
    document.createElement(
      "button"
    );

  deleteButton.type =
    "button";

  deleteButton.className =
    "file-action danger";

  deleteButton.textContent =
    "Hapus";

  deleteButton.addEventListener(
    "click",
    () => deleteFile(file)
  );


  actions.append(
    openButton,
    downloadButton,
    deleteButton
  );


  details.append(
    name,
    meta,
    actions
  );


  card.append(
    preview,
    details
  );

  return card;

}


/* ============================================================
   FILE ICON
   ============================================================ */

function createFileIcon(
  label
) {

  const icon =
    document.createElement(
      "div"
    );

  icon.className =
    "file-icon";

  icon.textContent =
    String(label || "FILE")
      .slice(0, 8);

  return icon;

}


/* ============================================================
   FILE TYPE
   ============================================================ */

function getFileTypeLabel(
  file
) {

  const mime =
    String(
      file?.mimeType ||
      file?.type ||
      ""
    ).toLowerCase();

  const name =
    String(
      file?.name ||
      ""
    ).toLowerCase();

  if (
    mime.startsWith("video/")
  ) {
    return "VIDEO";
  }

  if (
    mime.startsWith("image/")
  ) {
    return "IMAGE";
  }

  if (
    mime.startsWith("audio/")
  ) {
    return "AUDIO";
  }

  if (
    mime === "application/pdf" ||
    name.endsWith(".pdf")
  ) {
    return "PDF";
  }

  if (
    mime.includes("zip") ||
    name.endsWith(".zip")
  ) {
    return "ZIP";
  }

  if (
    name.endsWith(".rar")
  ) {
    return "RAR";
  }

  if (
    name.endsWith(".7z")
  ) {
    return "7Z";
  }

  if (
    mime.includes("text") ||
    name.endsWith(".txt")
  ) {
    return "TEXT";
  }

  return "FILE";

}


/* ============================================================
   MIME HELPERS
   ============================================================ */

function getMime(
  file
) {

  return String(
    file?.mimeType ||
    file?.type ||
    ""
  ).toLowerCase();

}


function isImageFile(
  file
) {

  return getMime(
    file
  ).startsWith(
    "image/"
  );

}


function isVideoFile(
  file
) {

  return getMime(
    file
  ).startsWith(
    "video/"
  );

}


function isAudioFile(
  file
) {

  return getMime(
    file
  ).startsWith(
    "audio/"
  );

}


/* ============================================================
   PREVIEW URL
   ============================================================ */

function getPreviewUrl(
  file
) {

  if (
    file?.previewUrl
  ) {

    return file.previewUrl;

  }

  if (
    file?.id
  ) {

    return buildApiUrl(
      `/api/files/${encodeURIComponent(
        file.id
      )}`
    );

  }

  return "";

}


/* ============================================================
   DOWNLOAD URL
   ============================================================ */

function getDownloadUrl(
  file
) {

  if (
    file?.downloadUrl
  ) {

    return file.downloadUrl;

  }

  if (
    file?.id
  ) {

    return buildApiUrl(
      `/api/files/${encodeURIComponent(
        file.id
      )}/download`
    );

  }

  return "";

}


/* ============================================================
   UPLOAD
   ============================================================ */

async function handleFileSelection(
  event
) {

  const files =
    Array.from(
      event.target.files || []
    );

  event.target.value =
    "";

  if (!files.length) {
    return;
  }

  await uploadFiles(
    files
  );

}


async function uploadFiles(
  files
) {

  if (!state.token) {

    showLogin();

    return;

  }

  if (state.busy) {

    showToast(
      "Tunggu proses sebelumnya selesai."
    );

    return;

  }

  const oversized =
    files.find(
      (file) =>
        file.size >
        CONFIG.MAX_FILE_SIZE
    );

  if (oversized) {

    showToast(
      `File "${oversized.name}" melebihi batas 5GB.`
    );

    return;

  }

  state.busy =
    true;

  uploadArea.classList.remove(
    "hidden"
  );

  setUploadProgress(
    0,
    "Menyiapkan upload..."
  );

  try {

    for (
      let index = 0;
      index < files.length;
      index++
    ) {

      const file =
        files[index];

      setUploadProgress(
        Math.round(
          (index /
            files.length) *
            100
        ),
        `Menyiapkan ${file.name}...`
      );

      await uploadSingleFile(
        file
      );

      setUploadProgress(
        Math.round(
          ((index + 1) /
            files.length) *
            100
        ),
        `${file.name} selesai.`
      );

    }

    await loadFiles();

    showToast(
      `${files.length} file berhasil disimpan.`
    );

  } catch (error) {

    showToast(
      error.message
    );

  } finally {

    setTimeout(
      () => {

        uploadArea.classList.add(
          "hidden"
        );

      },
      700
    );

    state.busy =
      false;

  }

}


/* ============================================================
   SINGLE FILE UPLOAD
   ============================================================ */

async function uploadSingleFile(
  file
) {

  /*
    Backend dapat menggunakan:
    1. multipart upload endpoint, atau
    2. presigned upload URL.

    Frontend mencoba endpoint /api/files.
  */

  const formData =
    new FormData();

  formData.append(
    "file",
    file,
    file.name
  );

  await uploadWithProgress(
    "/api/files",
    formData
  );

}


/* ============================================================
   UPLOAD WITH PROGRESS
   ============================================================ */

function uploadWithProgress(
  path,
  formData
) {

  return new Promise(
    (resolve, reject) => {

      const xhr =
        new XMLHttpRequest();

      xhr.open(
        "POST",
        buildApiUrl(path),
        true
      );

      xhr.setRequestHeader(
        "Authorization",
        `Bearer ${state.token}`
      );

      xhr.setRequestHeader(
        "Cache-Control",
        "no-store"
      );

      xhr.upload.addEventListener(
        "progress",
        (event) => {

          if (!event.lengthComputable) {
            return;
          }

          const percent =
            Math.round(
              (event.loaded /
                event.total) *
                100
            );

          setUploadProgress(
            percent,
            `Mengupload... ${formatBytes(
              event.loaded
            )} / ${formatBytes(
              event.total
            )}`
          );

        }
      );

      xhr.addEventListener(
        "load",
        () => {

          let data = {};

          try {

            data =
              xhr.responseText
                ? JSON.parse(
                    xhr.responseText
                  )
                : {};

          } catch {

            data = {};

          }

          if (
            xhr.status >= 200 &&
            xhr.status < 300
          ) {

            resolve(data);

            return;

          }

          if (
            xhr.status === 401 ||
            xhr.status === 403
          ) {

            clearSession();

          }

          reject(
            new Error(
              data?.message ||
              `Upload gagal (${xhr.status}).`
            )
          );

        }
      );

      xhr.addEventListener(
        "error",
        () => {

          reject(
            new Error(
              "Upload gagal karena koneksi."
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

      xhr.send(
        formData
      );

    }
  );

}


function setUploadProgress(
  percent,
  text
) {

  const safePercent =
    Math.max(
      0,
      Math.min(
        100,
        Number(percent) || 0
      )
    );

  uploadProgressBar.style.width =
    `${safePercent}%`;

  uploadProgressText.textContent =
    `${safePercent}%`;

  uploadStatusText.textContent =
    text || "";

}


/* ============================================================
   OPEN FILE
   ============================================================ */

async function openViewer(
  file
) {

  state.viewerFile =
    file;

  viewerTitle.textContent =
    file.name || "Preview";

  viewerContent.innerHTML =
    "";

  const mime =
    getMime(file);

  if (
    isImageFile(file)
  ) {

    const img =
      document.createElement(
        "img"
      );

    img.alt =
      file.name || "Image";

    img.src =
      getPreviewUrl(file);

    viewerContent.appendChild(
      img
    );

  }

  else if (
    isVideoFile(file)
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

    video.preload =
      "metadata";

    video.src =
      getPreviewUrl(file);

    viewerContent.appendChild(
      video
    );

  }

  else if (
    isAudioFile(file)
  ) {

    const audio =
      document.createElement(
        "audio"
      );

    audio.controls =
      true;

    audio.preload =
      "metadata";

    audio.src =
      getPreviewUrl(file);

    viewerContent.appendChild(
      audio
    );

  }

  else if (
    mime ===
      "application/pdf" ||
    String(file.name || "")
      .toLowerCase()
      .endsWith(".pdf")
  ) {

    const iframe =
      document.createElement(
        "iframe"
      );

    iframe.title =
      file.name || "PDF";

    iframe.src =
      getPreviewUrl(file);

    viewerContent.appendChild(
      iframe
    );

  }

  else {

    const message =
      document.createElement(
        "div"
      );

    message.className =
      "viewer-file-message";

    const strong =
      document.createElement(
        "strong"
      );

    strong.textContent =
      "Preview tidak tersedia";

    const span =
      document.createElement(
        "span"
      );

    span.textContent =
      "Jenis file ini tidak dapat ditampilkan langsung di browser. Gunakan tombol Download untuk menyimpan file ke perangkat.";

    message.append(
      strong,
      span
    );

    viewerContent.appendChild(
      message
    );

  }

  viewerModal.classList.remove(
    "hidden"
  );

  viewerModal.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.style.overflow =
    "hidden";

}


/* ============================================================
   CLOSE VIEWER
   ============================================================ */

function closeViewer() {

  viewerModal.classList.add(
    "hidden"
  );

  viewerModal.setAttribute(
    "aria-hidden",
    "true"
  );

  viewerContent.innerHTML =
    "";

  state.viewerFile =
    null;

  document.body.style.overflow =
    "";

}


/* ============================================================
   VIEWER DOWNLOAD
   ============================================================ */

async function handleViewerDownload() {

  if (
    !state.viewerFile
  ) {
    return;
  }

  await downloadFile(
    state.viewerFile
  );

}


/* ============================================================
   DOWNLOAD FILE
   ============================================================ */

async function downloadFile(
  file
) {

  if (!state.token) {

    showLogin();

    return;

  }

  try {

    const url =
      getDownloadUrl(file);

    if (!url) {

      throw new Error(
        "URL download tidak tersedia."
      );

    }

    /*
      Backend dapat memberikan presigned URL.
      Jika URL berasal dari backend sendiri,
      kita tambahkan Authorization.
    */

    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${state.token}`
          },

          cache: "no-store"
        }
      );

    if (!response.ok) {

      if (
        response.status === 401 ||
        response.status === 403
      ) {

        clearSession();

      }

      throw new Error(
        `Download gagal (${response.status}).`
      );

    }

    const blob =
      await response.blob();

    const blobUrl =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      blobUrl;

    anchor.download =
      file.name ||
      "download";

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    setTimeout(
      () => {
        URL.revokeObjectURL(
          blobUrl
        );
      },
      1000
    );

    showToast(
      "Download dimulai."
    );

  } catch (error) {

    showToast(
      error.message
    );

  }

}


/* ============================================================
   DELETE FILE
   ============================================================ */

async function deleteFile(
  file
) {

  if (!file?.id) {

    showToast(
      "ID file tidak tersedia."
    );

    return;

  }

  const confirmed =
    window.confirm(
      `Hapus "${file.name}" dari BRANKAS?\n\nFile akan dihapus dari vault.`
    );

  if (!confirmed) {
    return;
  }

  try {

    await apiRequest(
      `/api/files/${encodeURIComponent(
        file.id
      )}`,
      {
        method: "DELETE"
      }
    );

    state.files =
      state.files.filter(
        (item) =>
          String(item.id) !==
          String(file.id)
      );

    renderFiles();

    closeViewer();

    showToast(
      "File berhasil dihapus."
    );

  } catch (error) {

    showToast(
      error.message
    );

  }

}


/* ============================================================
   PAGE SWITCHING
   ============================================================ */

function switchPage(
  page
) {

  const validPages = [
    "vault",
    "downloader"
  ];

  if (
    !validPages.includes(page)
  ) {

    page = "vault";

  }

  state.activePage =
    page;

  navButtons.forEach(
    (button) => {

      button.classList.toggle(
        "active",
        button.dataset.page ===
          page
      );

    }
  );

  pages.forEach(
    (section) => {

      const isActive =
        section.id ===
        `${page}Page`;

      section.classList.toggle(
        "active",
        isActive
      );

    }
  );

}


/* ============================================================
   DOWNLOADER SOURCE
   ============================================================ */

function switchDownloaderSource(
  source
) {

  const validSources = [
    "vid3y",
    "tiktok"
  ];

  if (
    !validSources.includes(
      source
    )
  ) {

    source = "vid3y";

  }

  state.activeSource =
    source;

  sourceTabs.forEach(
    (button) => {

      button.classList.toggle(
        "active",
        button.dataset.source ===
          source
      );

    }
  );

  sourcePanels.forEach(
    (panel) => {

      panel.classList.toggle(
        "active",
        panel.id ===
          `${source}Source`
      );

    }
  );

  clearDownloaderMessage();

}


/* ============================================================
   VID3Y IMPORT
   ============================================================ */

async function handleVid3yImport() {

  const url =
    vid3yUrl.value.trim();

  clearDownloaderMessage();

  if (!isValidHttpUrl(url)) {

    showDownloaderMessage(
      "Masukkan URL Vid3y yang valid."
    );

    return;

  }

  setButtonBusy(
    vid3yDownloadButton,
    true,
    "Memproses..."
  );

  try {

    const result =
      await apiRequest(
        "/api/import/vid3y",
        {
          method: "POST",
          body: {
            url
          }
        }
      );

    vid3yUrl.value =
      "";

    showDownloaderMessage(
      result.message ||
      "Media berhasil disimpan ke BRANKAS.",
      true
    );

    await loadFiles();

  } catch (error) {

    showDownloaderMessage(
      error.message
    );

  } finally {

    setButtonBusy(
      vid3yDownloadButton,
      false
    );

  }

}


/* ============================================================
   TIKTOK IMPORT
   ============================================================ */

async function handleTikTokImport() {

  const url =
    tiktokUrl.value.trim();

  clearDownloaderMessage();

  if (!isValidHttpUrl(url)) {

    showDownloaderMessage(
      "Masukkan URL TikTok yang valid."
    );

    return;

  }

  if (
    !isTikTokUrl(url)
  ) {

    showDownloaderMessage(
      "URL tersebut bukan URL TikTok yang dikenali."
    );

    return;

  }

  setButtonBusy(
    tiktokDownloadButton,
    true,
    "Memproses..."
  );

  try {

    const result =
      await apiRequest(
        "/api/import/tiktok",
        {
          method: "POST",
          body: {
            url
          }
        }
      );

    tiktokUrl.value =
      "";

    showDownloaderMessage(
      result.message ||
      "Media berhasil disimpan ke BRANKAS.",
      true
    );

    await loadFiles();

  } catch (error) {

    showDownloaderMessage(
      error.message
    );

  } finally {

    setButtonBusy(
      tiktokDownloadButton,
      false
    );

  }

}


/* ============================================================
   DOWNLOADER MESSAGES
   ============================================================ */

function showDownloaderMessage(
  message,
  success = false
) {

  if (!downloaderMessage) {
    return;
  }

  downloaderMessage.textContent =
    String(message || "");

  downloaderMessage.classList.toggle(
    "success",
    success
  );

}


function clearDownloaderMessage() {

  if (!downloaderMessage) {
    return;
  }

  downloaderMessage.textContent =
    "";

  downloaderMessage.classList.remove(
    "success"
  );

}


/* ============================================================
   URL VALIDATION
   ============================================================ */

function isValidHttpUrl(
  value
) {

  try {

    const url =
      new URL(value);

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


function isTikTokUrl(
  value
) {

  try {

    const url =
      new URL(value);

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
   BUTTON STATE
   ============================================================ */

function setButtonBusy(
  button,
  busy,
  busyText
) {

  if (!button) {
    return;
  }

  if (busy) {

    if (
      !button.dataset.originalText
    ) {

      button.dataset.originalText =
        button.textContent;

    }

    button.disabled =
      true;

    button.textContent =
      busyText ||
      "Memproses...";

  } else {

    button.disabled =
      false;

    button.textContent =
      button.dataset.originalText ||
      button.textContent;

    delete button.dataset.originalText;

  }

}


/* ============================================================
   TOAST
   ============================================================ */

let toastTimer = null;

function showToast(
  message
) {

  if (!toast) {
    return;
  }

  toast.textContent =
    String(message || "");

  toast.classList.add(
    "show"
  );

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {

        toast.classList.remove(
          "show"
        );

      },
      3000
    );

}


/* ============================================================
   KEYBOARD
   ============================================================ */

function handleKeyboard(
  event
) {

  if (
    event.key ===
    "Escape"
  ) {

    if (
      !viewerModal.classList.contains(
        "hidden"
      )
    ) {

      closeViewer();

    }

  }

}


/* ============================================================
   FORMATTING
   ============================================================ */

function formatBytes(
  bytes
) {

  const value =
    Number(bytes);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {

    return "0 B";

  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  const index =
    Math.min(
      Math.floor(
        Math.log(value) /
        Math.log(1024)
      ),
      units.length - 1
    );

  const amount =
    value /
    Math.pow(
      1024,
      index
    );

  return `${
    amount >= 100
      ? amount.toFixed(0)
      : amount >= 10
        ? amount.toFixed(1)
        : amount.toFixed(2)
  } ${units[index]}`;

}


function formatDate(
  value
) {

  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "-";

  }

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  ).format(date);

}


/* ============================================================
   SECURITY / PAGE LIFECYCLE
   ============================================================ */

window.addEventListener(
  "pageshow",
  () => {

    if (
      state.sessionExpires &&
      Date.now() >=
        state.sessionExpires
    ) {

      clearSession();

      showLogin();

    }

  }
);


/* ============================================================
   SESSION EXPIRATION CHECK
   ============================================================ */

setInterval(
  () => {

    if (
      state.token &&
      state.sessionExpires &&
      Date.now() >=
        state.sessionExpires
    ) {

      clearSession();

      state.files = [];

      renderFiles();

      showLogin();

      showAuthMessage(
        "Session telah berakhir. Silakan masuk kembali."
      );

    }

  },
  30 * 1000
);
