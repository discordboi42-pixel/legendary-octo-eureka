const uploadForm = document.getElementById("uploadForm");
const audioFileInput = document.getElementById("audioFile");
const dateInput = document.getElementById("dateInput");
const dayInput = document.getElementById("dayInput");
const titleInput = document.getElementById("titleInput");
const searchInput = document.getElementById("searchInput");
const recordingsList = document.getElementById("recordingsList");
const emptyState = document.getElementById("emptyState");
const recordingTemplate = document.getElementById("recordingTemplate");
const shareInput = document.getElementById("shareLink");
const copyShareBtn = document.getElementById("copyShareBtn");
const ownerAuthForm = document.getElementById("ownerAuthForm");
const ownerKeyInput = document.getElementById("ownerKeyInput");
const unlockBtn = document.getElementById("unlockBtn");
const lockBtn = document.getElementById("lockBtn");
const authStatus = document.getElementById("authStatus");

const OWNER_KEY_STORAGE = "sphoorthiOwnerKey";
let ownerKey = localStorage.getItem(OWNER_KEY_STORAGE) || "";
let allRecordings = [];

init();

async function init() {
  shareInput.value = window.location.href;
  setUploadEnabled(Boolean(ownerKey));
  allRecordings = await fetchRecordings();
  renderRecordings(allRecordings);
}

async function fetchRecordings() {
  const response = await fetch("/api/recordings");
  if (!response.ok) {
    return [];
  }
  return response.json();
}

ownerAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = ownerKeyInput.value.trim();
  if (!key) {
    authStatus.textContent = "Please enter your upload key.";
    return;
  }

  unlockBtn.disabled = true;
  const probe = await fetch("/api/recordings", {
    method: "POST",
    headers: { "X-Upload-Key": key },
    body: new FormData()
  });
  unlockBtn.disabled = false;

  if (probe.status === 401) {
    authStatus.textContent = "Wrong key. Upload mode remains locked.";
    return;
  }

  ownerKey = key;
  localStorage.setItem(OWNER_KEY_STORAGE, ownerKey);
  ownerKeyInput.value = "";
  setUploadEnabled(true);
  authStatus.textContent = "Upload mode unlocked. You can now upload/delete.";
});

lockBtn.addEventListener("click", () => {
  ownerKey = "";
  localStorage.removeItem(OWNER_KEY_STORAGE);
  setUploadEnabled(false);
  authStatus.textContent = "Upload mode locked.";
});

function setUploadEnabled(enabled) {
  for (const el of [audioFileInput, dateInput, dayInput, titleInput, uploadForm.querySelector("#uploadBtn")]) {
    el.disabled = !enabled;
  }
  uploadForm.setAttribute("aria-disabled", String(!enabled));
  document.body.classList.toggle("owner-unlocked", enabled);
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ownerKey) {
    authStatus.textContent = "Unlock upload mode first.";
    return;
  }

  const file = audioFileInput.files[0];
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append("audioFile", file);
  formData.append("selectedDate", dateInput.value);
  formData.append("selectedDay", dayInput.value);
  formData.append("title", titleInput.value.trim());

  const response = await fetch("/api/recordings", {
    method: "POST",
    headers: { "X-Upload-Key": ownerKey },
    body: formData
  });

  if (response.status === 401) {
    authStatus.textContent = "Key no longer valid. Please unlock again.";
    ownerKey = "";
    localStorage.removeItem(OWNER_KEY_STORAGE);
    setUploadEnabled(false);
    return;
  }

  if (!response.ok) {
    alert("Upload failed. Please try again.");
    return;
  }

  allRecordings = await fetchRecordings();
  renderRecordings(filterRecordings(searchInput.value));
  uploadForm.reset();
});

searchInput.addEventListener("input", () => {
  renderRecordings(filterRecordings(searchInput.value));
});

copyShareBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareInput.value);
    copyShareBtn.textContent = "Copied!";
    setTimeout(() => {
      copyShareBtn.textContent = "Copy";
    }, 1200);
  } catch {
    shareInput.select();
    document.execCommand("copy");
  }
});

function filterRecordings(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return allRecordings;
  return allRecordings.filter((item) =>
    item.title.toLowerCase().includes(normalized) ||
    item.selectedDate.toLowerCase().includes(normalized) ||
    item.selectedDay.toLowerCase().includes(normalized) ||
    item.fileName.toLowerCase().includes(normalized)
  );
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
    const title = node.querySelector(".recording-title");
    const dateBig = node.querySelector(".date-big");
    const daySide = node.querySelector(".day-side");
    const meta = node.querySelector(".meta");
    const audio = node.querySelector("audio");
    const deleteButton = node.querySelector(".delete-btn");

    title.textContent = recording.title;
    dateBig.textContent = recording.selectedDate;
    daySide.textContent = recording.selectedDay;
    meta.textContent = `Uploaded: ${formatUploadedAt(recording.uploadedAt)} • File: ${recording.fileName}`;
    audio.src = recording.audioUrl;

    if (ownerKey) {
      deleteButton.hidden = false;
      deleteButton.addEventListener("click", async () => {
        const response = await fetch(`/api/recordings/${recording.id}`, {
          method: "DELETE",
          headers: { "X-Upload-Key": ownerKey }
        });

        if (response.status === 401) {
          authStatus.textContent = "Key no longer valid. Please unlock again.";
          ownerKey = "";
          localStorage.removeItem(OWNER_KEY_STORAGE);
          setUploadEnabled(false);
          renderRecordings(filterRecordings(searchInput.value));
          return;
        }

        if (!response.ok) {
          alert("Could not delete recording.");
          return;
        }
        allRecordings = await fetchRecordings();
        renderRecordings(filterRecordings(searchInput.value));
      });
    }

    recordingsList.appendChild(node);
  });
}
