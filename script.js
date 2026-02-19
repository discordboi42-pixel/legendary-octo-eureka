const DB_NAME = "sphoorthiDB";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

const uploadForm = document.getElementById("uploadForm");
const audioFileInput = document.getElementById("audioFile");
const dateInput = document.getElementById("dateInput");
const dayInput = document.getElementById("dayInput");
const titleInput = document.getElementById("titleInput");
const searchInput = document.getElementById("searchInput");
const recordingsList = document.getElementById("recordingsList");
const emptyState = document.getElementById("emptyState");
const recordingTemplate = document.getElementById("recordingTemplate");

let db;
let allRecordings = [];

init();

async function init() {
  db = await openDatabase();
  allRecordings = await getAllRecordings();
  renderRecordings(allRecordings);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(storeMode = "readonly") {
  return db.transaction(STORE_NAME, storeMode).objectStore(STORE_NAME);
}

function addRecording(recording) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").add(recording);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteRecording(id) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getAllRecordings() {
  return new Promise((resolve, reject) => {
    const request = transaction().getAll();
    request.onsuccess = () => {
      const sorted = request.result.sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      resolve(sorted);
    };
    request.onerror = () => reject(request.error);
  });
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = audioFileInput.files[0];
  if (!file) {
    return;
  }

  const selectedDate = dateInput.value;
  const selectedDay = dayInput.value;

  const record = {
    id: crypto.randomUUID(),
    title: titleInput.value.trim(),
    selectedDate,
    selectedDay,
    uploadedAt: new Date().toISOString(),
    fileName: file.name,
    fileBlob: file,
    fileType: file.type || "audio/mpeg"
  };

  await addRecording(record);
  allRecordings = await getAllRecordings();
  renderRecordings(filterRecordings(searchInput.value));
  uploadForm.reset();
});

searchInput.addEventListener("input", () => {
  renderRecordings(filterRecordings(searchInput.value));
});

function filterRecordings(query) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return allRecordings;
  }

  return allRecordings.filter((item) => {
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.selectedDate.toLowerCase().includes(normalized) ||
      item.selectedDay.toLowerCase().includes(normalized) ||
      item.fileName.toLowerCase().includes(normalized)
    );
  });
}

function formatUploadedAt(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(isoDate));
}

function renderRecordings(recordings) {
  recordingsList.innerHTML = "";
  emptyState.style.display = recordings.length ? "none" : "block";

  recordings.forEach((recording) => {
    const node = recordingTemplate.content.cloneNode(true);
    const listItem = node.querySelector(".recording-item");
    const dateBig = node.querySelector(".date-big");
    const daySide = node.querySelector(".day-side");
    const title = node.querySelector(".recording-title");
    const meta = node.querySelector(".meta");
    const audio = node.querySelector("audio");
    const deleteButton = node.querySelector(".delete-btn");

    dateBig.textContent = recording.selectedDate;
    daySide.textContent = recording.selectedDay;
    title.textContent = recording.title;
    meta.textContent = `Uploaded: ${formatUploadedAt(recording.uploadedAt)} • File: ${recording.fileName}`;

    const blobUrl = URL.createObjectURL(new Blob([recording.fileBlob], { type: recording.fileType }));
    audio.src = blobUrl;

    audio.addEventListener("ended", () => URL.revokeObjectURL(blobUrl), { once: true });

    deleteButton.addEventListener("click", async () => {
      await deleteRecording(recording.id);
      allRecordings = await getAllRecordings();
      renderRecordings(filterRecordings(searchInput.value));
    });

    listItem.addEventListener("DOMNodeRemoved", () => URL.revokeObjectURL(blobUrl), { once: true });
    recordingsList.appendChild(node);
  });
}
