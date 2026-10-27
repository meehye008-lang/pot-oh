// ===== Supabase 연결 정보 (공개 키만 넣는다) =====
const SUPABASE_URL = "https://yzoahyduyfzovzsptced.supabase.co";
const SUPABASE_KEY = "sb_publishable_7cVwlalWLIAFKsBm45fXIg_d__r7EqK";

const BUCKET = "resume";
const SESSION_KEY = "resume_admin_session";

// 올릴 수 있는 파일: 10MB까지, 이미지와 PDF
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const IMAGE_OR_PDF_TYPES = [...IMAGE_TYPES, "application/pdf"];
const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote",
];

// 지금 로그인한 정보: { access_token, refresh_token, expires_at, email, user_id }
let session = null;
let projects = [];
let likeCounts = {};
// 카드 폼 상태: 수정 중인 카드 번호(id)와 지금 들어 있는 파일 주소
let editingId = null;
let formThumbUrl = null;
let formFileUrl = null;


// ===== 작은 도우미 =====
function byId(id) {
  return document.getElementById(id);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function makeButton(text, className, onClick) {
  const button = makeElement("button", className, text);
  button.type = "button";
  button.addEventListener("click", () => onClick(button));
  return button;
}

function showStatus(id, text, isError) {
  const status = byId(id);
  status.textContent = text;
  status.classList.toggle("error", Boolean(isError));
}

// 버튼을 누르는 동안 잠가 두기 (두 번 눌림 방지)
async function whileBusy(button, work) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await work();
  } finally {
    button.disabled = false;
  }
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 이번 창에서는 동작 */ }
}
function removeStorage(key) {
  try { localStorage.removeItem(key); } catch { /* 무시 */ }
}

function formatDate(value) {
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 주소에서 파일 이름만 보여 주기
function fileNameOf(url) {
  return url ? decodeURIComponent(url.split("/").pop()) : "";
}


// ===== 로그인 (Supabase Auth) =====
async function authRequest(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.msg || "auth " + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
    email: data.user ? data.user.email : session && session.email,
    user_id: data.user ? data.user.id : session && session.user_id,
  };
  writeStorage(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  session = null;
  removeStorage(SESSION_KEY);
}

// 토큰이 곧 끝나면 새 토큰으로 바꿔 둔다 (동시에 여러 번 바꾸지 않도록 하나로 묶음)
let refreshing = null;
async function getAccessToken() {
  if (!session) throw new Error("로그인이 필요해요");
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;

  if (!refreshing) {
    refreshing = authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(saveSession)
      .finally(() => { refreshing = null; });
  }
  try {
    await refreshing;
  } catch (error) {
    sessionExpired();
    throw error;
  }
  return session.access_token;
}

function sessionExpired() {
  clearSession();
  showView("login");
  showStatus("login-status", "로그인이 끝났어요. 다시 로그인해 주세요.", true);
}

async function login(button) {
  const email = byId("login-email").value.trim();
  const password = byId("login-password").value;
  if (!email || !password) {
    showStatus("login-status", "이메일과 비밀번호를 모두 적어 주세요.", true);
    return;
  }
  await whileBusy(button, async () => {
    showStatus("login-status", "로그인 중…");
    try {
      const data = await authRequest("token?grant_type=password", { email, password });
      saveSession(data);
      byId("login-password").value = "";
      showStatus("login-status", "");
      await enter();
    } catch (error) {
      const wrong = error.status === 400 || error.status === 401;
      showStatus("login-status", wrong ? "이메일이나 비밀번호가 맞지 않아요." : "로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.", true);
    }
  });
}

async function logout() {
  const token = session && session.access_token;
  clearSession();
  showView("login");
  if (token) authRequest("logout", {}, token).catch(() => {});
}


// ===== Supabase 표 부르기 (로그인 토큰을 붙여서) =====
async function api(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401) {
    sessionExpired();
    throw new Error("로그인이 끝났어요");
  }
  if (!response.ok) {
    const error = new Error("Supabase 요청 실패: " + response.status);
    error.status = response.status;
    throw error;
  }
  return response;
}

// 고치기·지우기: 실제로 바뀐 줄을 돌려받아, 0줄이면 "권한 없음"으로 본다
async function change(path, method, body) {
  const response = await api(path, {
    method,
    body,
    headers: { Prefer: "return=representation" },
  });
  const rows = await response.json();
  if (!rows.length) throw new Error("바뀐 내용이 없어요 (권한이 없을 수 있어요)");
  return rows;
}

async function countLikes(projectId) {
  const response = await api(`likes?select=id&project_id=eq.${projectId}`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  const range = response.headers.get("content-range") || "";
  return Number(range.split("/")[1]) || 0;
}


// ===== 파일 올리기 (resume 보관함) =====
// 문제가 있으면 안내 문구를, 괜찮으면 빈 글자를 돌려준다
function checkFile(file, allowedTypes) {
  if (!file) return "";
  if (!allowedTypes.includes(file.type)) {
    return allowedTypes.includes("application/pdf")
      ? "이미지(PNG·JPG·WEBP·GIF)나 PDF 파일만 올릴 수 있어요."
      : "이미지(PNG·JPG·WEBP·GIF) 파일만 올릴 수 있어요.";
  }
  if (file.size > MAX_FILE_SIZE) return "10MB보다 큰 파일은 올릴 수 없어요.";
  return "";
}

// 파일 이름은 영어·숫자로 새로 짓는다. 예: projects/1761550000000-a8k2m9.pdf
function newFileName(folder, file) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${folder}/${Date.now()}-${random}.${EXTENSIONS[file.type]}`;
}

async function uploadFile(file, folder) {
  const path = newFileName(folder, file);
  const token = await getAccessToken();
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    body: file,
  });
  if (!response.ok) throw new Error("파일 올리기 실패: " + response.status);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}


// ===== 화면 바꾸기 =====
function showView(name) {
  byId("login-view").hidden = name !== "login";
  byId("denied-view").hidden = name !== "denied";
  byId("admin-view").hidden = name !== "admin";

  const loggedIn = name !== "login";
  byId("logout-button").hidden = !loggedIn;
  byId("user-email").hidden = !loggedIn;
  byId("user-email").textContent = loggedIn && session ? session.email : "";
}

// 로그인한 사람이 관리자인지 확인하고 알맞은 화면을 보여 준다
async function enter() {
  try {
    const response = await api(`admins?select=user_id&user_id=eq.${session.user_id}`);
    const rows = await response.json();
    if (!rows.length) {
      showView("denied");
      return;
    }
    showView("admin");
    loadProfile().catch(() => showStatus("profile-status", "프로필을 불러오지 못했어요.", true));
    loadProjects().catch(() => showStatus("project-status", "카드를 불러오지 못했어요.", true));
    loadGuestbook().catch(() => showStatus("guest-admin-status", "방명록을 불러오지 못했어요.", true));
  } catch {
    if (session) {
      showView("login");
      showStatus("login-status", "관리자 정보를 확인하지 못했어요. 다시 로그인해 주세요.", true);
    }
  }
}


// ===== 프로필 =====
function showPhoto(url) {
  const preview = byId("pf-photo-preview");
  preview.style.backgroundImage = url ? `url("${url}")` : "";
  byId("pf-photo-remove").hidden = !url;
}

async function loadProfile() {
  const response = await api("profile?select=*&id=eq.1");
  const [profile] = await response.json();
  PROFILE_FIELDS.forEach((field) => {
    byId("pf-" + field).value = profile ? profile[field] || "" : "";
  });
  showPhoto(profile && profile.photo_url);
}

async function saveProfile(button) {
  await whileBusy(button, async () => {
    const fields = {};
    PROFILE_FIELDS.forEach((field) => { fields[field] = byId("pf-" + field).value.trim(); });
    try {
      await upsertProfile(fields);
      showStatus("profile-status", "저장했어요. 방문자 화면을 새로고침하면 보여요.");
    } catch {
      showStatus("profile-status", "저장하지 못했어요. 다시 해 주세요.", true);
    }
  });
}

// profile 줄이 없으면 새로 만들고, 있으면 보낸 칸만 고친다
function upsertProfile(fields) {
  return api("profile?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { id: 1, ...fields, updated_at: new Date().toISOString() },
  }).then(async (response) => {
    const rows = await response.json();
    if (!rows.length) throw new Error("저장되지 않았어요");
    return rows;
  });
}

async function uploadProfilePhoto() {
  const input = byId("pf-photo");
  const file = input.files[0];
  if (!file) return;

  const problem = checkFile(file, IMAGE_TYPES);
  if (problem) {
    showStatus("profile-status", problem, true);
    input.value = "";
    return;
  }

  input.disabled = true;
  showStatus("profile-status", "사진을 올리는 중…");
  try {
    const url = await uploadFile(file, "profile");
    await upsertProfile({ photo_url: url });
    showPhoto(url);
    showStatus("profile-status", "프로필 사진을 바꿨어요.");
  } catch {
    showStatus("profile-status", "사진을 올리지 못했어요. 다시 해 주세요.", true);
  } finally {
    input.disabled = false;
    input.value = "";
  }
}

async function removeProfilePhoto(button) {
  if (!confirm("프로필 사진을 지울까요?")) return;
  await whileBusy(button, async () => {
    try {
      await upsertProfile({ photo_url: null });
      showPhoto(null);
      showStatus("profile-status", "프로필 사진을 지웠어요.");
    } catch {
      showStatus("profile-status", "사진을 지우지 못했어요.", true);
    }
  });
}


// ===== 포트폴리오 카드 =====
async function loadProjects() {
  const response = await api("projects?select=*&order=sort_order.asc,id.asc");
  projects = await response.json();
  const counts = await Promise.all(projects.map((p) => countLikes(p.id).catch(() => 0)));
  likeCounts = {};
  projects.forEach((p, i) => { likeCounts[p.id] = counts[i]; });

  renderProjects();
  renderLikes();
  if (editingId === null) byId("pj-sort").value = nextSortOrder();
}

function nextSortOrder() {
  return projects.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
}

function renderProjects() {
  const list = byId("project-list");
  if (!projects.length) {
    list.replaceChildren(makeElement("li", "notice", "아직 카드가 없어요. 위에서 추가해 주세요."));
    return;
  }

  list.replaceChildren(...projects.map((project, index) => {
    const item = makeElement("li", "admin-item");

    const thumb = makeElement("div", "thumb-mini");
    if (project.thumbnail_url) thumb.style.backgroundImage = `url("${project.thumbnail_url}")`;

    const info = makeElement("div", "admin-item-info");
    const meta = [project.number, project.category].filter(Boolean).join(" · ");
    info.append(
      makeElement("p", "card-meta", meta),
      makeElement("p", "admin-item-title", project.title),
      makeElement("p", "admin-item-sub",
        `순서 ${project.sort_order} · ♥ ${likeCounts[project.id] || 0}` +
        (project.file_url ? " · 첨부 파일 있음" : ""))
    );

    const buttons = makeElement("div", "admin-item-buttons");
    const up = makeButton("▲", "small-button", (b) => moveProject(index, -1, b));
    up.setAttribute("aria-label", "위로");
    up.disabled = index === 0;
    const down = makeButton("▼", "small-button", (b) => moveProject(index, 1, b));
    down.setAttribute("aria-label", "아래로");
    down.disabled = index === projects.length - 1;
    buttons.append(
      up,
      down,
      makeButton("수정", "small-button", () => startEdit(project)),
      makeButton("삭제", "small-button danger", (b) => deleteProject(project, b))
    );

    item.append(thumb, info, buttons);
    return item;
  }));
}

function showFormFiles() {
  byId("pj-thumb-current").textContent = formThumbUrl ? "지금 썸네일: " + fileNameOf(formThumbUrl) : "";
  byId("pj-thumb-remove").hidden = !formThumbUrl;
  byId("pj-file-current").textContent = formFileUrl ? "지금 첨부 파일: " + fileNameOf(formFileUrl) : "";
  byId("pj-file-remove").hidden = !formFileUrl;
}

function resetProjectForm() {
  editingId = null;
  formThumbUrl = null;
  formFileUrl = null;
  ["number", "category", "title", "description", "tags"].forEach((f) => { byId("pj-" + f).value = ""; });
  byId("pj-sort").value = nextSortOrder();
  byId("pj-thumb").value = "";
  byId("pj-file").value = "";
  byId("pj-heading").textContent = "새 카드 추가";
  byId("pj-save").textContent = "카드 추가";
  byId("pj-cancel").hidden = true;
  showFormFiles();
}

function startEdit(project) {
  editingId = project.id;
  formThumbUrl = project.thumbnail_url;
  formFileUrl = project.file_url;
  byId("pj-number").value = project.number;
  byId("pj-category").value = project.category;
  byId("pj-title").value = project.title;
  byId("pj-description").value = project.description;
  byId("pj-tags").value = (project.tags || []).join(", ");
  byId("pj-sort").value = project.sort_order;
  byId("pj-thumb").value = "";
  byId("pj-file").value = "";
  byId("pj-heading").textContent = `카드 수정: ${project.title}`;
  byId("pj-save").textContent = "수정 저장";
  byId("pj-cancel").hidden = false;
  showFormFiles();
  showStatus("project-status", "");
  byId("pj-heading").scrollIntoView({ behavior: "smooth", block: "start" });
}

// 파일을 고르자마자 검사해서 안내한다
function checkPickedFile(inputId, allowedTypes) {
  const input = byId(inputId);
  const problem = checkFile(input.files[0], allowedTypes);
  if (problem) {
    showStatus("project-status", problem, true);
    input.value = "";
  } else {
    showStatus("project-status", "");
  }
}

async function saveProject(button) {
  const title = byId("pj-title").value.trim();
  if (!title) {
    showStatus("project-status", "제목을 적어 주세요.", true);
    return;
  }
  const thumbFile = byId("pj-thumb").files[0];
  const attachFile = byId("pj-file").files[0];
  const problem = checkFile(thumbFile, IMAGE_TYPES) || checkFile(attachFile, IMAGE_OR_PDF_TYPES);
  if (problem) {
    showStatus("project-status", problem, true);
    return;
  }

  await whileBusy(button, async () => {
    try {
      showStatus("project-status", "저장하는 중…");
      if (thumbFile) formThumbUrl = await uploadFile(thumbFile, "projects");
      if (attachFile) formFileUrl = await uploadFile(attachFile, "projects");

      const sortValue = parseInt(byId("pj-sort").value, 10);
      const body = {
        number: byId("pj-number").value.trim(),
        category: byId("pj-category").value.trim(),
        title,
        description: byId("pj-description").value.trim(),
        tags: byId("pj-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
        sort_order: Number.isNaN(sortValue) ? nextSortOrder() : sortValue,
        thumbnail_url: formThumbUrl || null,
        file_url: formFileUrl || null,
      };

      if (editingId === null) {
        await change("projects", "POST", body);
      } else {
        await change(`projects?id=eq.${editingId}`, "PATCH", body);
      }
      const wasEditing = editingId !== null;
      await loadProjects();
      resetProjectForm();
      showStatus("project-status", wasEditing ? "카드를 고쳤어요." : "카드를 추가했어요.");
    } catch {
      showStatus("project-status", "저장하지 못했어요. 다시 해 주세요.", true);
    }
  });
}

async function deleteProject(project, button) {
  if (!confirm(`"${project.title}" 카드를 지울까요?\n이 카드의 좋아요도 함께 지워져요.`)) return;
  await whileBusy(button, async () => {
    try {
      await change(`projects?id=eq.${project.id}`, "DELETE");
      if (editingId === project.id) resetProjectForm();
      await loadProjects();
      showStatus("project-status", "카드를 지웠어요.");
    } catch {
      showStatus("project-status", "카드를 지우지 못했어요.", true);
    }
  });
}

// 위·아래로 옮기기: 자리를 바꾼 뒤 순서를 1, 2, 3… 으로 다시 매긴다
async function moveProject(index, direction, button) {
  const target = index + direction;
  if (target < 0 || target >= projects.length) return;
  await whileBusy(button, async () => {
    const ordered = [...projects];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    try {
      await Promise.all(ordered.map((project, i) =>
        project.sort_order === i + 1
          ? null
          : change(`projects?id=eq.${project.id}`, "PATCH", { sort_order: i + 1 })
      ));
      showStatus("project-status", "순서를 바꿨어요.");
    } catch {
      showStatus("project-status", "순서를 바꾸지 못했어요.", true);
    }
    await loadProjects();
  });
}


// ===== 좋아요 =====
function renderLikes() {
  const list = byId("like-list");
  if (!projects.length) {
    list.replaceChildren(makeElement("li", "notice", "카드가 없어요."));
    return;
  }
  list.replaceChildren(...projects.map((project) => {
    const item = makeElement("li", "admin-item");
    const info = makeElement("div", "admin-item-info");
    info.append(makeElement("p", "admin-item-title", project.title));
    const count = makeElement("span", "like-number", "♥ " + (likeCounts[project.id] || 0));
    const reset = makeButton("좋아요 초기화", "small-button danger", (b) => resetLikes(project, b));
    reset.disabled = !likeCounts[project.id];
    item.append(info, count, reset);
    return item;
  }));
}

async function resetLikes(project, button) {
  if (!confirm(`"${project.title}" 카드의 좋아요 ${likeCounts[project.id]}개를 모두 지울까요?`)) return;
  await whileBusy(button, async () => {
    try {
      await change(`likes?project_id=eq.${project.id}`, "DELETE");
      await loadProjects();
      showStatus("like-status", "좋아요를 초기화했어요.");
    } catch {
      showStatus("like-status", "초기화하지 못했어요.", true);
    }
  });
}


// ===== 방명록 =====
async function loadGuestbook() {
  const list = byId("admin-guest-list");
  const response = await api("resume_guestbook?select=*&order=created_at.desc&limit=200");
  const entries = await response.json();
  if (!entries.length) {
    list.replaceChildren(makeElement("li", "notice", "방명록 글이 없어요."));
    return;
  }
  list.replaceChildren(...entries.map((entry) => {
    const item = makeElement("li", "admin-item");
    const info = makeElement("div", "admin-item-info");
    const head = makeElement("div", "guest-head");
    head.append(
      makeElement("span", "guest-nick", entry.nickname),
      makeElement("span", "guest-date", formatDate(entry.created_at))
    );
    info.append(head, makeElement("p", "guest-text", entry.message));
    item.append(info, makeButton("삭제", "small-button danger", (b) => deleteGuest(entry, b)));
    return item;
  }));
}

async function deleteGuest(entry, button) {
  if (!confirm(`${entry.nickname} 님의 글을 지울까요?\n"${entry.message}"`)) return;
  await whileBusy(button, async () => {
    try {
      await change(`resume_guestbook?id=eq.${entry.id}`, "DELETE");
      await loadGuestbook();
      showStatus("guest-admin-status", "글을 지웠어요.");
    } catch {
      showStatus("guest-admin-status", "글을 지우지 못했어요.", true);
    }
  });
}


// ===== 버튼 연결 =====
byId("login-button").addEventListener("click", (e) => login(e.currentTarget));
["login-email", "login-password"].forEach((id) => {
  byId(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) login(byId("login-button"));
  });
});
byId("logout-button").addEventListener("click", logout);

byId("pf-save").addEventListener("click", (e) => saveProfile(e.currentTarget));
byId("pf-photo").addEventListener("change", uploadProfilePhoto);
byId("pf-photo-remove").addEventListener("click", (e) => removeProfilePhoto(e.currentTarget));

byId("pj-save").addEventListener("click", (e) => saveProject(e.currentTarget));
byId("pj-cancel").addEventListener("click", () => { resetProjectForm(); showStatus("project-status", ""); });
byId("pj-thumb").addEventListener("change", () => checkPickedFile("pj-thumb", IMAGE_TYPES));
byId("pj-file").addEventListener("change", () => checkPickedFile("pj-file", IMAGE_OR_PDF_TYPES));
byId("pj-thumb-remove").addEventListener("click", () => { formThumbUrl = null; showFormFiles(); });
byId("pj-file-remove").addEventListener("click", () => { formFileUrl = null; showFormFiles(); });


// ===== 시작: 전에 로그인해 둔 게 있으면 이어서 =====
try { session = JSON.parse(readStorage(SESSION_KEY)); } catch { session = null; }
if (session && session.access_token) {
  enter();   // 관리자인지 확인이 끝나면 알맞은 화면이 나타난다
} else {
  showView("login");
}
